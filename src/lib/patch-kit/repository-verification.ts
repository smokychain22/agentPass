import fs from "node:fs/promises";
import path from "node:path";
import { execa, type ExecaReturnValue } from "execa";
import { createScanWorkspace, removeWorkspace } from "@/lib/server/workspace";
import { detectPackageManager } from "@/lib/scanner/detect-package-manager";
import type { VerifyCheckResult } from "@/lib/jobs/types";
import { copyRepoBaseline } from "./generate-unified-diff";
import { dedupeConsolidatedEdits, type ConsolidatedEdit } from "./merge-patches";
import {
  ensureVerificationDependencies,
  formatInstallFailureReason,
  inferRequiredPackagesForScripts,
  type InstallAttemptRecord,
} from "@/lib/execution/workspace-install";
import { extractApplyablePatch } from "./validate-patch";
import { applyEditsToWorkspace } from "./canonical-patch";

export type RepositoryVerificationStatus = "verified" | "blocked" | "failed" | "not_run";

export interface RepositoryVerificationResult {
  status: RepositoryVerificationStatus;
  failureCode?: "DEPENDENCY_INSTALL_FAILED" | "CHECK_FAILED";
  error?: string;
  installAttempts: InstallAttemptRecord[];
  checks: VerifyCheckResult[];
}

const COMMAND_TIMEOUT_MS = 180_000;
const ALLOWED_SCRIPT_NAMES = ["typecheck", "lint", "test", "build"] as const;

function summarize(text: string, max = 400): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function localBinPath(rootDir: string): string {
  return path.join(rootDir, "node_modules", ".bin");
}

function verificationEnv(rootDir: string, scriptName?: string): NodeJS.ProcessEnv {
  const localBin = localBinPath(rootDir);
  const pathEnv = process.env.PATH ?? "";
  return {
    ...process.env,
    CI: "true",
    FORCE_COLOR: "0",
    NODE_ENV: scriptName === "build" ? "production" : "test",
    PATH: `${localBin}${path.delimiter}${pathEnv}`,
  };
}

async function readScripts(rootDir: string): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(path.join(rootDir, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    return Object.fromEntries(
      Object.entries(pkg.scripts ?? {}).filter(([name]) =>
        (ALLOWED_SCRIPT_NAMES as readonly string[]).includes(name)
      )
    );
  } catch {
    return {};
  }
}

function runScriptCommand(pm: string, name: string): string[] {
  switch (pm) {
    case "pnpm":
      return ["pnpm", "run", name];
    case "yarn":
      return ["yarn", name];
    case "bun":
      return ["bun", "run", name];
    default:
      return ["npm", "run", name];
  }
}

async function commandExists(rootDir: string, binName: string): Promise<boolean> {
  try {
    await fs.access(path.join(localBinPath(rootDir), binName));
    return true;
  } catch {
    return false;
  }
}

async function runVerificationScript(
  rootDir: string,
  pm: string,
  name: string,
  scriptCmd: string
): Promise<ExecaReturnValue> {
  const env = verificationEnv(rootDir, name);
  const primary = runScriptCommand(pm, name);
  let result = await execa(primary[0], primary.slice(1), {
    cwd: rootDir,
    timeout: COMMAND_TIMEOUT_MS,
    reject: false,
    env,
  });

  const stderr = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  const missingBinary = /command not found|ENOENT|cannot find module/i.test(stderr);
  if (result.exitCode === 0 || !missingBinary) {
    return result;
  }

  if (name === "typecheck" && scriptCmd.includes("tsc")) {
    const tscBin = path.join(rootDir, "node_modules", "typescript", "bin", "tsc");
    try {
      await fs.access(tscBin);
      return execa("node", [tscBin, "--noEmit"], {
        cwd: rootDir,
        timeout: COMMAND_TIMEOUT_MS,
        reject: false,
        env,
      });
    } catch {
      return result;
    }
  }

  if (name === "build" && scriptCmd.includes("next")) {
    const nextBin = path.join(rootDir, "node_modules", "next", "dist", "bin", "next");
    try {
      await fs.access(nextBin);
      return execa("node", [nextBin, "build"], {
        cwd: rootDir,
        timeout: COMMAND_TIMEOUT_MS,
        reject: false,
        env: verificationEnv(rootDir, "build"),
      });
    } catch {
      return result;
    }
  }

  return result;
}

async function applyPatchOrEdits(
  rootDir: string,
  patch: string | undefined,
  edits: ConsolidatedEdit[]
): Promise<void> {
  if (patch?.trim()) {
    const applyable = extractApplyablePatch(patch);
    if (applyable.trim()) {
      const patchFile = path.join(rootDir, ".repodiet-verify.patch");
      await fs.writeFile(patchFile, applyable, "utf8");
      const { ensureGitRepoInitialized } = await import("./git-runtime");
      const initialized = await ensureGitRepoInitialized(rootDir);
      if (initialized) {
        const apply = await execa("git", ["apply", "--index", patchFile], {
          cwd: rootDir,
          reject: false,
          timeout: 60_000,
        });
        if (apply.exitCode === 0) return;
      }
    }
  }

  await applyEditsToWorkspace(rootDir, edits);
}

export async function runRepositoryVerification(input: {
  baselineRoot: string;
  edits: ConsolidatedEdit[];
  cleanupRunId: string;
  patch?: string;
  /** Already-patched cleanup workspace — avoids a second copy + full reinstall on serverless. */
  patchedRoot?: string;
}): Promise<RepositoryVerificationResult> {
  const deduped = dedupeConsolidatedEdits(input.edits);
  if (deduped.length === 0) {
    return { status: "not_run", installAttempts: [], checks: [] };
  }

  const reusePatchedRoot = Boolean(input.patchedRoot);
  const workspace = reusePatchedRoot ? null : await createScanWorkspace("repo-verify");
  const verifyRoot = input.patchedRoot ?? path.join(workspace!.artifactsPath, "root");
  const checks: VerifyCheckResult[] = [];
  let installAttempts: InstallAttemptRecord[] = [];

  try {
    if (!reusePatchedRoot) {
      await copyRepoBaseline(input.baselineRoot, verifyRoot);
      await applyPatchOrEdits(verifyRoot, input.patch, deduped);
    }

    const pkgPath = path.join(verifyRoot, "package.json");
    const hasPackageJson = await fs.access(pkgPath).then(() => true).catch(() => false);
    if (!hasPackageJson) {
      return {
        status: "verified",
        installAttempts: [],
        checks: [
          {
            name: "dependency install",
            command: "n/a",
            status: "skipped",
            exitCode: null,
            durationMs: 0,
            stdoutSummary: "No package.json — install skipped.",
            stderrSummary: "",
          },
        ],
      };
    }

    const scripts = await readScripts(verifyRoot);
    const requiredPackages = inferRequiredPackagesForScripts(scripts);
    const patchedPaths = deduped.map((edit) => edit.path.replace(/\\/g, "/"));

    const installResult = await ensureVerificationDependencies(
      verifyRoot,
      input.cleanupRunId,
      {
        requiredPackages,
        patchedPaths,
        preserveExistingModules: reusePatchedRoot,
      }
    );
    installAttempts = installResult.attempts;
    const installDetail =
      installResult.reason ??
      formatInstallFailureReason(installResult.stderr ?? "", installResult.stdout ?? "");
    checks.push({
      name: "dependency install",
      command: installResult.command ?? "npm ci",
      status: installResult.installed ? "passed" : "failed",
      exitCode: installResult.exitCode ?? null,
      durationMs: installResult.durationMs ?? 0,
      stdoutSummary: summarize(installResult.stdout ?? ""),
      stderrSummary: summarize(installDetail),
    });

    if (!installResult.installed) {
      return {
        status: "blocked",
        failureCode: "DEPENDENCY_INSTALL_FAILED",
        error: installDetail || "Could not install repository dependencies.",
        installAttempts,
        checks,
      };
    }

    const pm = (await detectPackageManager(verifyRoot)).packageManager;
    for (const name of ALLOWED_SCRIPT_NAMES) {
      const scriptCmd = scripts[name];
      if (!scriptCmd) continue;

      if (name === "typecheck" && !(await commandExists(verifyRoot, "tsc"))) {
        checks.push({
          name,
          command: scriptCmd,
          status: "failed",
          exitCode: 1,
          durationMs: 0,
          stdoutSummary: "",
          stderrSummary: "typescript is not installed in node_modules/.bin after npm ci.",
        });
        continue;
      }
      if (name === "build" && scriptCmd.includes("next") && !(await commandExists(verifyRoot, "next"))) {
        checks.push({
          name,
          command: scriptCmd,
          status: "failed",
          exitCode: 1,
          durationMs: 0,
          stdoutSummary: "",
          stderrSummary: "next is not installed in node_modules/.bin after npm ci.",
        });
        continue;
      }

      const t0 = Date.now();
      const command = runScriptCommand(pm, name);
      const result = await runVerificationScript(verifyRoot, pm, name, scriptCmd);
      checks.push({
        name,
        command: command.join(" "),
        status: result.exitCode === 0 ? "passed" : "failed",
        exitCode: result.exitCode ?? null,
        durationMs: Date.now() - t0,
        stdoutSummary: summarize(result.stdout ?? ""),
        stderrSummary: summarize(result.stderr ?? ""),
      });
    }

    const executed = checks.filter((c) => c.status === "passed" || c.status === "failed");
    const required = executed.filter((c) => c.name === "typecheck" || c.name === "build");
    const requiredFailed = required.filter((c) => c.status === "failed");
    if (requiredFailed.length > 0) {
      const detail = requiredFailed
        .map((c) => `${c.name}: ${c.stderrSummary || c.stdoutSummary || "failed"}`)
        .join("; ");
      return {
        status: "failed",
        failureCode: "CHECK_FAILED",
        error: `Repository verification failed — ${detail}`,
        installAttempts,
        checks,
      };
    }

    const anyFailed = executed.some((c) => c.status === "failed");
    return {
      status: anyFailed ? "failed" : "verified",
      failureCode: anyFailed ? "CHECK_FAILED" : undefined,
      error: anyFailed ? "One or more repository checks failed after applying cleanup." : undefined,
      installAttempts,
      checks,
    };
  } catch (err) {
    return {
      status: "failed",
      failureCode: "CHECK_FAILED",
      error: err instanceof Error ? err.message : "Repository verification failed.",
      installAttempts,
      checks,
    };
  } finally {
    if (workspace) {
      await removeWorkspace(workspace.root).catch(() => {});
    }
  }
}
