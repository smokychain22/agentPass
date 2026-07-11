import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { detectPackageManager } from "@/lib/scanner/detect-package-manager";
import { getStoredPatchKit } from "@/lib/patch-kit/patch-kit-store";
import type { PatchKitPayload } from "@/lib/patch-kit/types";
import { extractApplyablePatch, patchHasDeleteOperations } from "@/lib/patch-kit/validate-patch";
import type { PackageManager } from "@/lib/scanner/types";
import type { VerifyCheckResult } from "@/lib/jobs/types";

const COMMAND_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 180_000;
const TOTAL_TIMEOUT_MS = 300_000;

const ALLOWED_SCRIPT_NAMES = ["build", "lint", "test", "typecheck", "check", "check:types"];

function summarizeOutput(text: string, max = 500): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

async function readPackageScripts(rootDir: string): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(path.join(rootDir, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    return Object.fromEntries(
      Object.entries(scripts).filter(([name]) => ALLOWED_SCRIPT_NAMES.includes(name))
    );
  } catch {
    return {};
  }
}

function installCommand(pm: PackageManager): string[] {
  switch (pm) {
    case "pnpm":
      return ["pnpm", "install", "--ignore-scripts", "--no-frozen-lockfile"];
    case "yarn":
      return ["yarn", "install", "--ignore-scripts"];
    case "bun":
      return ["bun", "install", "--ignore-scripts"];
    default:
      return ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"];
  }
}

function runScriptCommand(pm: PackageManager, name: string): string[] {
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

async function runCheck(
  rootDir: string,
  name: string,
  command: string[],
  started: number
): Promise<VerifyCheckResult> {
  const t0 = Date.now();
  if (Date.now() - started > TOTAL_TIMEOUT_MS) {
    return {
      name,
      command: command.join(" "),
      status: "skipped",
      exitCode: null,
      durationMs: 0,
      stdoutSummary: "",
      stderrSummary: "Skipped due to total verification timeout.",
    };
  }

  const result = await execa(command[0], command.slice(1), {
    cwd: rootDir,
    timeout: COMMAND_TIMEOUT_MS,
    reject: false,
    env: { ...process.env, CI: "true", FORCE_COLOR: "0", NODE_ENV: "test" },
  });

  return {
    name,
    command: command.join(" "),
    status: result.exitCode === 0 ? "passed" : "failed",
    exitCode: result.exitCode ?? null,
    durationMs: Date.now() - t0,
    stdoutSummary: summarizeOutput(result.stdout ?? ""),
    stderrSummary: summarizeOutput(result.stderr ?? ""),
  };
}

export async function runVerification(
  patchId: string,
  inlinePayload?: PatchKitPayload
): Promise<{
  status: "passed" | "failed" | "partial" | "not_run";
  checks: VerifyCheckResult[];
  limitations: string[];
}> {
  const payload = inlinePayload ?? (await getStoredPatchKit(patchId))?.payload;
  if (!payload) {
    throw new Error("Patch bundle not found.");
  }
  const limitations: string[] = [];
  const checks: VerifyCheckResult[] = [];
  const started = Date.now();

  const repoUrl = `https://github.com/${payload.repo.owner}/${payload.repo.name}`;
  const workspace = await prepareRepoWorkspace(repoUrl, payload.repo.branch);

  try {
    const patch = payload.artifacts.cleanupPatch;
    const patchFile = path.join(workspace.workDir, "repodiet-cleanup.patch");
    const applyable = extractApplyablePatch(patch);
    await fs.writeFile(patchFile, applyable, "utf8");

    await execa("git", ["init"], { cwd: workspace.rootDir, reject: false });
    await execa("git", ["add", "-A"], { cwd: workspace.rootDir, reject: false });
    await execa(
      "git",
      ["-c", "user.email=repodiet@local", "-c", "user.name=RepoDiet", "commit", "-m", "baseline", "--allow-empty"],
      { cwd: workspace.rootDir, reject: false }
    );

    if (patchHasDeleteOperations(patch)) {
      const applyCheckStarted = Date.now();
      const applyCheck = await execa("git", ["apply", "--check", patchFile], {
        cwd: workspace.rootDir,
        reject: false,
        timeout: COMMAND_TIMEOUT_MS,
      });
      checks.push({
        name: "git apply --check",
        command: "git apply --check repodiet-cleanup.patch",
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
          command: "git apply repodiet-cleanup.patch",
          status: apply.exitCode === 0 ? "passed" : "failed",
          exitCode: apply.exitCode ?? null,
          durationMs: Date.now() - applyStarted,
          stdoutSummary: summarizeOutput(apply.stdout ?? ""),
          stderrSummary: summarizeOutput(apply.stderr ?? ""),
        });
      } else {
        limitations.push("Patch did not pass git apply --check; script checks skipped.");
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
      limitations.push("Patch contained no delete operations.");
    }

    const pkgPath = path.join(workspace.rootDir, "package.json");
    const hasPackageJson = await fs.access(pkgPath).then(() => true).catch(() => false);

    if (!hasPackageJson) {
      limitations.push("No package.json — build/lint/typecheck skipped.");
    } else {
      const pm = (await detectPackageManager(workspace.rootDir)).packageManager;
      const installStarted = Date.now();
      const installCmd = installCommand(pm);
      const install = await execa(installCmd[0], installCmd.slice(1), {
        cwd: workspace.rootDir,
        timeout: INSTALL_TIMEOUT_MS,
        reject: false,
        env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
      });
      checks.push({
        name: "dependency install",
        command: installCmd.join(" "),
        status: install.exitCode === 0 ? "passed" : "failed",
        exitCode: install.exitCode ?? null,
        durationMs: Date.now() - installStarted,
        stdoutSummary: summarizeOutput(install.stdout ?? ""),
        stderrSummary: summarizeOutput(install.stderr ?? ""),
      });

      if (install.exitCode !== 0) {
        limitations.push("Dependency install failed; script checks may be unreliable.");
      }

      const scripts = await readPackageScripts(workspace.rootDir);
      for (const name of ["typecheck", "lint", "test", "build"]) {
        if (!scripts[name]) continue;
        checks.push(
          await runCheck(workspace.rootDir, name, runScriptCommand(pm, name), started)
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
