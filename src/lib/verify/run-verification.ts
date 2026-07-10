import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { getStoredPatchKit } from "@/lib/patch-kit/patch-kit-store";
import { patchHasDeleteOperations } from "@/lib/patch-kit/validate-patch";
import type { VerifyCheckResult } from "@/lib/jobs/types";

const COMMAND_TIMEOUT_MS = 120_000;
const TOTAL_TIMEOUT_MS = 300_000;

const ALLOWED_SCRIPT_NAMES = new Set([
  "build",
  "lint",
  "test",
  "typecheck",
  "check",
  "check:types",
  "tsc",
]);

interface PackageJsonScripts {
  scripts?: Record<string, string>;
}

function summarizeOutput(text: string, max = 400): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

async function readPackageScripts(rootDir: string): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(path.join(rootDir, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as PackageJsonScripts;
    const scripts = pkg.scripts ?? {};
    return Object.fromEntries(
      Object.entries(scripts).filter(([name]) => ALLOWED_SCRIPT_NAMES.has(name))
    );
  } catch {
    return {};
  }
}

async function runAllowedCommand(
  rootDir: string,
  name: string,
  command: string,
  packageManager: string
): Promise<VerifyCheckResult> {
  const started = Date.now();
  const runVia = packageManager === "pnpm"
    ? ["pnpm", "run", name]
    : packageManager === "yarn"
      ? ["yarn", name]
      : ["npm", "run", name];

  const result = await execa(runVia[0], runVia.slice(1), {
    cwd: rootDir,
    timeout: COMMAND_TIMEOUT_MS,
    reject: false,
    env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
  });

  return {
    name,
    command,
    status: result.exitCode === 0 ? "passed" : "failed",
    exitCode: result.exitCode ?? null,
    durationMs: Date.now() - started,
    stdoutSummary: summarizeOutput(result.stdout ?? ""),
    stderrSummary: summarizeOutput(result.stderr ?? ""),
  };
}

export async function runVerification(patchId: string): Promise<{
  status: "passed" | "failed" | "partial" | "not_run";
  checks: VerifyCheckResult[];
  limitations: string[];
}> {
  const stored = getStoredPatchKit(patchId);
  if (!stored) {
    throw new Error("Patch bundle not found.");
  }

  const { payload } = stored;
  const limitations: string[] = [];
  const checks: VerifyCheckResult[] = [];
  const started = Date.now();

  const repoUrl = `https://github.com/${payload.repo.owner}/${payload.repo.name}`;
  const workspace = await prepareRepoWorkspace(repoUrl, payload.repo.branch);

  try {
    const patch = payload.artifacts.cleanupPatch;
    const patchFile = path.join(workspace.workDir, "repodiet-cleanup.patch");
    await fs.writeFile(patchFile, patch, "utf8");

    if (patchHasDeleteOperations(patch)) {
      await execa("git", ["init"], { cwd: workspace.rootDir, reject: false });
      await execa("git", ["add", "-A"], { cwd: workspace.rootDir, reject: false });
      await execa(
        "git",
        ["-c", "user.email=repodiet@local", "-c", "user.name=RepoDiet", "commit", "-m", "baseline", "--allow-empty"],
        { cwd: workspace.rootDir, reject: false }
      );

      const applyCheckStarted = Date.now();
      const applyCheck = await execa("git", ["apply", "--check", patchFile], {
        cwd: workspace.rootDir,
        reject: false,
        timeout: COMMAND_TIMEOUT_MS,
      });
      checks.push({
        name: "git apply --check",
        command: `git apply --check ${patchFile}`,
        status: applyCheck.exitCode === 0 ? "passed" : "failed",
        exitCode: applyCheck.exitCode ?? null,
        durationMs: Date.now() - applyCheckStarted,
        stdoutSummary: summarizeOutput(applyCheck.stdout ?? ""),
        stderrSummary: summarizeOutput(applyCheck.stderr ?? ""),
      });

      if (applyCheck.exitCode === 0) {
        const applyStarted = Date.now();
        const apply = await execa("git", ["apply", patchFile], {
          cwd: workspace.rootDir,
          reject: false,
          timeout: COMMAND_TIMEOUT_MS,
        });
        checks.push({
          name: "git apply",
          command: `git apply ${patchFile}`,
          status: apply.exitCode === 0 ? "passed" : "failed",
          exitCode: apply.exitCode ?? null,
          durationMs: Date.now() - applyStarted,
          stdoutSummary: summarizeOutput(apply.stdout ?? ""),
          stderrSummary: summarizeOutput(apply.stderr ?? ""),
        });
      }
    } else {
      checks.push({
        name: "git apply --check",
        command: "n/a",
        status: "skipped",
        exitCode: null,
        durationMs: 0,
        stdoutSummary: "No delete operations in patch.",
        stderrSummary: "",
      });
      limitations.push("Patch contained no delete operations; apply step skipped.");
    }

    const scripts = await readPackageScripts(workspace.rootDir);
    const scriptNames = Object.keys(scripts);

    if (scriptNames.length === 0) {
      limitations.push("No allowlisted package scripts detected for automated verification.");
    } else if (Date.now() - started > TOTAL_TIMEOUT_MS) {
      limitations.push("Total verification timeout reached before command execution.");
    } else {
      limitations.push(
        "Dependency installation is skipped in serverless verification for safety. Commands run only when node_modules already exists or scripts do not require install."
      );

      for (const name of ["typecheck", "lint", "test", "build"]) {
        if (!scripts[name]) continue;
        if (Date.now() - started > TOTAL_TIMEOUT_MS) {
          limitations.push(`Skipped ${name} due to total timeout.`);
          break;
        }
        checks.push(
          await runAllowedCommand(workspace.rootDir, name, scripts[name], "npm")
        );
      }
    }
  } finally {
    await workspace.cleanup();
  }

  const executed = checks.filter((c) => c.status === "passed" || c.status === "failed");
  const passed = executed.filter((c) => c.status === "passed").length;
  const failed = executed.filter((c) => c.status === "failed").length;

  let status: "passed" | "failed" | "partial" | "not_run" = "not_run";
  if (executed.length === 0) status = "not_run";
  else if (failed === 0) status = "passed";
  else if (passed === 0) status = "failed";
  else status = "partial";

  return { status, checks, limitations };
}
