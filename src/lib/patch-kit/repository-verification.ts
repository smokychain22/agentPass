import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { createScanWorkspace, removeWorkspace } from "@/lib/server/workspace";
import { detectPackageManager } from "@/lib/scanner/detect-package-manager";
import type { VerifyCheckResult } from "@/lib/jobs/types";
import { copyRepoBaseline } from "./generate-unified-diff";
import { dedupeConsolidatedEdits, type ConsolidatedEdit } from "./merge-patches";
import {
  ensureWorkspaceDependenciesWithCache,
  type InstallAttemptRecord,
} from "@/lib/execution/workspace-install";
import { extractApplyablePatch } from "./validate-patch";

export type RepositoryVerificationStatus = "verified" | "blocked" | "failed" | "not_run";

export interface RepositoryVerificationResult {
  status: RepositoryVerificationStatus;
  failureCode?: "DEPENDENCY_INSTALL_FAILED" | "CHECK_FAILED";
  error?: string;
  installAttempts: InstallAttemptRecord[];
  checks: VerifyCheckResult[];
}

const COMMAND_TIMEOUT_MS = 120_000;
const ALLOWED_SCRIPT_NAMES = ["typecheck", "lint", "test", "build"] as const;

function summarize(text: string, max = 400): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
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

async function applyEdits(rootDir: string, edits: ConsolidatedEdit[]): Promise<void> {
  for (const edit of edits) {
    const full = path.join(rootDir, edit.path);
    if (edit.content === "") {
      await fs.rm(full, { force: true }).catch(() => {});
      continue;
    }
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, edit.content, "utf8");
  }
}

async function applyPatch(rootDir: string, patch: string): Promise<boolean> {
  const applyable = extractApplyablePatch(patch);
  if (!applyable.trim()) return false;
  const patchFile = path.join(rootDir, ".repodiet-verify.patch");
  await fs.writeFile(patchFile, applyable, "utf8");
  await execa("git", ["init"], { cwd: rootDir, reject: false });
  await execa("git", ["add", "-A"], { cwd: rootDir, reject: false });
  await execa(
    "git",
    [
      "-c",
      "user.email=repodiet@local",
      "-c",
      "user.name=RepoDiet",
      "commit",
      "-m",
      "baseline",
      "--allow-empty",
    ],
    { cwd: rootDir, reject: false }
  );
  const apply = await execa("git", ["apply", "--index", patchFile], {
    cwd: rootDir,
    reject: false,
    timeout: 60_000,
  });
  return apply.exitCode === 0;
}

export async function runRepositoryVerification(input: {
  baselineRoot: string;
  edits: ConsolidatedEdit[];
  cleanupRunId: string;
  patch?: string;
}): Promise<RepositoryVerificationResult> {
  const deduped = dedupeConsolidatedEdits(input.edits);
  if (deduped.length === 0) {
    return { status: "not_run", installAttempts: [], checks: [] };
  }

  const workspace = await createScanWorkspace("repo-verify");
  const verifyRoot = path.join(workspace.artifactsPath, "root");
  const checks: VerifyCheckResult[] = [];
  let installAttempts: InstallAttemptRecord[] = [];

  try {
    await copyRepoBaseline(input.baselineRoot, verifyRoot);

    if (input.patch?.trim()) {
      const applied = await applyPatch(verifyRoot, input.patch);
      if (!applied) {
        await applyEdits(verifyRoot, deduped);
      }
    } else {
      await applyEdits(verifyRoot, deduped);
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

    const installResult = await ensureWorkspaceDependenciesWithCache(
      verifyRoot,
      input.cleanupRunId
    );
    installAttempts = installResult.attempts;
    checks.push({
      name: "dependency install",
      command: installResult.command ?? "npm install",
      status: installResult.installed ? "passed" : "failed",
      exitCode: installResult.exitCode ?? null,
      durationMs: installResult.durationMs ?? 0,
      stdoutSummary: summarize(installResult.stdout ?? ""),
      stderrSummary: summarize(installResult.stderr ?? installResult.reason ?? ""),
    });

    if (!installResult.installed) {
      return {
        status: "blocked",
        failureCode: "DEPENDENCY_INSTALL_FAILED",
        error: installResult.reason ?? "Could not install repository dependencies.",
        installAttempts,
        checks,
      };
    }

    const pm = (await detectPackageManager(verifyRoot)).packageManager;
    const scripts = await readScripts(verifyRoot);
    for (const name of ALLOWED_SCRIPT_NAMES) {
      if (!scripts[name]) continue;
      const t0 = Date.now();
      const command = runScriptCommand(pm, name);
      const result = await execa(command[0], command.slice(1), {
        cwd: verifyRoot,
        timeout: COMMAND_TIMEOUT_MS,
        reject: false,
        env: { ...process.env, CI: "true", FORCE_COLOR: "0", NODE_ENV: "test" },
      });
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
    await removeWorkspace(workspace.root).catch(() => {});
  }
}
