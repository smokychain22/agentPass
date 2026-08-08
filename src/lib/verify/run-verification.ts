import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { runBoundedProcessGroup } from "@/lib/execution/bounded-process-group";
import { describeProcessTermination } from "@/lib/execution/workspace-install";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { detectPackageManager } from "@/lib/scanner/detect-package-manager";
import { getStoredPatchKit } from "@/lib/patch-kit/patch-kit-store";
import type { PatchKitPayload } from "@/lib/patch-kit/types";
import { extractApplyablePatch, patchHasDeleteOperations } from "@/lib/patch-kit/validate-patch";
import type { PackageManager } from "@/lib/scanner/types";
import type { VerifyCheckResult } from "@/lib/jobs/types";

/** Incident #26/#27 — see execution/workspace-install.ts. */
export const PRODUCTION_VERIFY_COMMAND_TIMEOUT_MS = 300_000;
function installTimeoutMs(): number {
  const o = Number(process.env.REPODIET_INSTALL_TIMEOUT_MS);
  return Number.isFinite(o) && o > 0 ? o : 600_000;
}
function commandTimeoutMs(): number {
  const o = Number(process.env.REPODIET_VERIFY_COMMAND_TIMEOUT_MS);
  return Number.isFinite(o) && o > 0 ? o : PRODUCTION_VERIFY_COMMAND_TIMEOUT_MS;
}
/**
 * Incident #26. The whole verification pass is a baseline install + checks and
 * a patched install + checks. With the per-step bounds raised to what this
 * machine can actually achieve, a 300s total would cut the pass off before its
 * own steps could finish. Still bounded, and still inside the heavy-job ceiling
 * and per-event deadline above it.
 *
 * Incident #34: 1,500,000ms was still smaller than the steps it wraps. This
 * pass is two installs and their checks — 600s + 300s + 600s + 300s = 1800s of
 * inner allowance — so the old total was 300s short before counting clone,
 * analysis or patch application, and cut the pass off mid-flight on production
 * twice on 2026-08-08. 2400s covers the inner sum with headroom and stays
 * strictly inside the 3000s heavy-job ceiling above it.
 */
export const PRODUCTION_VERIFY_TOTAL_TIMEOUT_MS = 2_400_000;
function totalTimeoutMs(): number {
  const o = Number(process.env.REPODIET_VERIFY_TOTAL_TIMEOUT_MS);
  return Number.isFinite(o) && o > 0 ? o : PRODUCTION_VERIFY_TOTAL_TIMEOUT_MS;
}

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
  if (Date.now() - started > totalTimeoutMs()) {
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

  /**
   * Incident #22: see bounded-process-group.ts. Heavy verification must yield
   * the machine to the runtime's liveness calls on a single shared vCPU —
   * `nice 19` alone proved insufficient in production, so this is also
   * bounded by process GROUP (a timed-out `execa` `timeout` signals only the
   * direct child) and paused whenever a liveness refresh needs to run.
   */
  const result = await runBoundedProcessGroup(command, {
    cwd: rootDir,
    timeoutMs: commandTimeoutMs(),
    env: { ...process.env, CI: "true", FORCE_COLOR: "0", NODE_ENV: "test" },
    label: `verify:${name}`,
  });

  /**
   * === Incident #35: a killed check and a genuine compile failure looked
   * identical ===
   *
   * `workspace-install.ts` has carried `describeProcessTermination` since
   * Incident #22/#26 specifically so a starved/OOM-killed process is never
   * mistaken for a real npm error — this file never had the equivalent for
   * `typecheck`/`build`, and it showed on 2026-08-08: production reported
   * "Baseline repository already fails verification" with a build stderr that
   * was nothing but the Next.js startup banner, cut off mid-sentence. Read
   * cold, that looks like a genuine compiler failure. Reproducing the exact
   * same commit locally — same Node version, unconstrained resources —
   * finished in well under a minute with a clean pass, which rules out a real
   * defect in the code under test. The truncated banner is the signature of a
   * process that never got past startup before something else ended it; the
   * result just never said so.
   *
   * Reusing `describeProcessTermination` rather than duplicating its signal/
   * exit-code table: a verification command and an install are both spawned
   * through the same `runBoundedProcessGroup`, so a timeout, SIGKILL, or
   * SIGTERM means exactly the same thing in both places.
   */
  const termination = describeProcessTermination(
    {
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
    },
    `Verification command "${name}"`
  );

  return {
    name,
    command: command.join(" "),
    status: result.exitCode === 0 ? "passed" : "failed",
    exitCode: result.exitCode ?? null,
    durationMs: Date.now() - t0,
    stdoutSummary: summarizeOutput(result.stdout ?? ""),
    stderrSummary: termination
      ? `${termination} raw_output=${summarizeOutput(result.stderr || result.stdout || "")}`
      : summarizeOutput(result.stderr ?? ""),
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
        timeout: commandTimeoutMs(),
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
          timeout: commandTimeoutMs(),
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
        timeout: installTimeoutMs(),
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
