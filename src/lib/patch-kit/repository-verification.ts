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
  humanizeInstallFailure,
  inferRequiredPackagesForScripts,
  type InstallAttemptRecord,
} from "@/lib/execution/workspace-install";
import {
  runDependencyPreflight,
  usesNextBuild,
} from "@/lib/execution/dependency-preflight";
import type {
  RepositoryVerificationOutcome,
  VerificationFailureCode,
} from "@/lib/execution/verification-error-codes";
import { humanizeVerificationFailure } from "@/lib/execution/verification-error-codes";
import { extractApplyablePatch } from "./validate-patch";
import { applyEditsToWorkspace } from "./canonical-patch";

export type RepositoryVerificationStatus = RepositoryVerificationOutcome;

export interface RepositoryVerificationPhaseResult {
  phase: "baseline" | "patched";
  installAttempts: InstallAttemptRecord[];
  checks: VerifyCheckResult[];
  preflight?: Awaited<ReturnType<typeof runDependencyPreflight>>;
}

export interface RepositoryVerificationResult {
  status: RepositoryVerificationStatus;
  outcome?: RepositoryVerificationOutcome;
  failureCode?: VerificationFailureCode;
  error?: string;
  installAttempts: InstallAttemptRecord[];
  checks: VerifyCheckResult[];
  baseline?: RepositoryVerificationPhaseResult;
  patched?: RepositoryVerificationPhaseResult;
}

const COMMAND_TIMEOUT_MS = 180_000;
const ALLOWED_SCRIPT_NAMES = ["typecheck", "lint", "test", "build"] as const;

function summarize(text: string, max = 400): string {
  const stripped = text.replace(/\u001b\[[0-9;]*m/g, "").replace(/\[[0-9;]*m/g, "");
  const trimmed = stripped.trim();
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

function fingerprintCheckFailure(check: VerifyCheckResult): string {
  return `${check.name}:${check.exitCode ?? "null"}:${(check.stderrSummary || check.stdoutSummary).slice(0, 120)}`;
}

function phasePassed(checks: VerifyCheckResult[]): boolean {
  const executed = checks.filter((c) => c.status === "passed" || c.status === "failed");
  const required = executed.filter((c) => c.name === "typecheck" || c.name === "build");
  if (required.length === 0) return executed.every((c) => c.status !== "failed");
  return required.every((c) => c.status === "passed");
}

async function runVerificationPhase(input: {
  rootDir: string;
  cleanupRunId: string;
  phase: "baseline" | "patched";
  patchedPaths?: string[];
}): Promise<RepositoryVerificationPhaseResult> {
  const checks: VerifyCheckResult[] = [];
  const scripts = await readScripts(input.rootDir);
  const requiredPackages = inferRequiredPackagesForScripts(scripts);
  const requireNextSwc = usesNextBuild(scripts);

  const installResult = await ensureVerificationDependencies(input.rootDir, input.cleanupRunId, {
    requiredPackages,
    patchedPaths: input.patchedPaths,
    cacheRole: input.phase === "baseline" ? "baseline" : "patched",
  });

  const installDetail = humanizeInstallFailure(
    installResult.reason ??
      formatInstallFailureReason(installResult.stderr ?? "", installResult.stdout ?? "")
  );

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
      phase: input.phase,
      installAttempts: installResult.attempts,
      checks,
    };
  }

  const preflight = await runDependencyPreflight(input.rootDir, {
    frameworkPackages: requireNextSwc
      ? ["next", "react", "react-dom"]
      : ["next", "react", "react-dom"],
    requireNextSwc,
  });

  checks.push({
    name: "dependency preflight",
    command: "npm ls + require.resolve",
    status: preflight.passed ? "passed" : "failed",
    exitCode: preflight.passed ? 0 : 1,
    durationMs: 0,
    stdoutSummary: summarize(preflight.npmLsOutput ?? ""),
    stderrSummary: preflight.error ?? "",
  });

  if (!preflight.passed) {
    return {
      phase: input.phase,
      installAttempts: installResult.attempts,
      checks,
      preflight,
    };
  }

  const pm = (await detectPackageManager(input.rootDir)).packageManager;
  for (const name of ALLOWED_SCRIPT_NAMES) {
    const scriptCmd = scripts[name];
    if (!scriptCmd) continue;

    if (name === "typecheck" && !(await commandExists(input.rootDir, "tsc"))) {
      checks.push({
        name,
        command: scriptCmd,
        status: "failed",
        exitCode: 1,
        durationMs: 0,
        stdoutSummary: "",
        stderrSummary: "typescript is not installed in node_modules/.bin after install.",
      });
      continue;
    }
    if (name === "build" && scriptCmd.includes("next") && !(await commandExists(input.rootDir, "next"))) {
      checks.push({
        name,
        command: scriptCmd,
        status: "failed",
        exitCode: 1,
        durationMs: 0,
        stdoutSummary: "",
        stderrSummary: "next is not installed in node_modules/.bin after install.",
      });
      continue;
    }

    const t0 = Date.now();
    const command = runScriptCommand(pm, name);
    const result = await runVerificationScript(input.rootDir, pm, name, scriptCmd);
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

  return {
    phase: input.phase,
    installAttempts: installResult.attempts,
    checks,
    preflight,
  };
}

function resolveOutcome(
  baseline: RepositoryVerificationPhaseResult,
  patched: RepositoryVerificationPhaseResult
): {
  status: RepositoryVerificationStatus;
  failureCode?: VerificationFailureCode;
  error?: string;
} {
  const baselineOk = phasePassed(baseline.checks);
  const patchedOk = phasePassed(patched.checks);

  const baselineInstall = baseline.checks.find((c) => c.name === "dependency install");
  const patchedInstall = patched.checks.find((c) => c.name === "dependency install");
  const baselinePreflight = baseline.checks.find((c) => c.name === "dependency preflight");
  const patchedPreflight = patched.checks.find((c) => c.name === "dependency preflight");

  if (baselineInstall?.status === "failed") {
    return {
      status: "baseline_blocked",
      failureCode: "BASELINE_BUILD_FAILED",
      error: baselineInstall.stderrSummary || "Baseline dependency installation failed.",
    };
  }
  if (baselinePreflight?.status === "failed") {
    return {
      status: "baseline_blocked",
      failureCode: baseline.preflight?.failureCode ?? "DECLARED_DEPENDENCY_NOT_INSTALLED",
      error:
        baselinePreflight.stderrSummary ||
        humanizeVerificationFailure(baseline.preflight?.failureCode ?? "DECLARED_DEPENDENCY_NOT_INSTALLED"),
    };
  }

  if (patchedInstall?.status === "failed") {
    return {
      status: "blocked",
      failureCode: "DEPENDENCY_INSTALL_FAILED",
      error: patchedInstall.stderrSummary || "Patched dependency installation failed.",
    };
  }
  if (patchedPreflight?.status === "failed") {
    return {
      status: "blocked",
      failureCode: patched.preflight?.failureCode ?? "DECLARED_DEPENDENCY_NOT_INSTALLED",
      error:
        patchedPreflight.stderrSummary ||
        humanizeVerificationFailure(patched.preflight?.failureCode ?? "DECLARED_DEPENDENCY_NOT_INSTALLED"),
    };
  }

  if (baselineOk && patchedOk) {
    return { status: "verified" };
  }

  if (baselineOk && !patchedOk) {
    const failed = patched.checks.filter((c) => c.status === "failed");
    const detail = failed.map((c) => `${c.name}: ${c.stderrSummary || c.stdoutSummary || "failed"}`).join("; ");
    return {
      status: "regression_failed",
      failureCode: "PATCH_REGRESSION",
      error: `Repository verification failed after cleanup — ${detail}`,
    };
  }

  if (!baselineOk && !patchedOk) {
    const baselineFailed = baseline.checks.filter((c) => c.status === "failed");
    const patchedFailed = patched.checks.filter((c) => c.status === "failed");
    const sameFingerprint =
      baselineFailed.length > 0 &&
      patchedFailed.length > 0 &&
      fingerprintCheckFailure(baselineFailed[0]!) === fingerprintCheckFailure(patchedFailed[0]!);

    if (sameFingerprint) {
      const detail = baselineFailed
        .map((c) => `${c.name}: ${c.stderrSummary || c.stdoutSummary || "failed"}`)
        .join("; ");
      return {
        status: "baseline_blocked",
        failureCode: "BASELINE_BUILD_FAILED",
        error: `Baseline repository already fails verification — ${detail}`,
      };
    }

    const detail = patchedFailed
      .map((c) => `${c.name}: ${c.stderrSummary || c.stdoutSummary || "failed"}`)
      .join("; ");
    return {
      status: "regression_failed",
      failureCode: "PATCH_REGRESSION",
      error: `Repository verification failed — ${detail}`,
    };
  }

  return {
    status: "improved_but_baseline_invalid",
    failureCode: "BASELINE_BUILD_FAILED",
    error: "Cleanup passed verification but the baseline repository was already invalid.",
  };
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
  const baselineRoot = path.join(workspace.artifactsPath, "baseline");
  const patchedRoot = path.join(workspace.artifactsPath, "patched");
  const patchedPaths = deduped.map((edit) => edit.path.replace(/\\/g, "/"));

  try {
    await copyRepoBaseline(input.baselineRoot, baselineRoot);

    const pkgPath = path.join(baselineRoot, "package.json");
    const hasPackageJson = await fs.access(pkgPath).then(() => true).catch(() => false);
    if (!hasPackageJson) {
      return {
        status: "verified",
        outcome: "verified",
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

    const baseline = await runVerificationPhase({
      rootDir: baselineRoot,
      cleanupRunId: input.cleanupRunId,
      phase: "baseline",
    });

    await copyRepoBaseline(input.baselineRoot, patchedRoot);
    await applyPatchOrEdits(patchedRoot, input.patch, deduped);

    const patched = await runVerificationPhase({
      rootDir: patchedRoot,
      cleanupRunId: input.cleanupRunId,
      phase: "patched",
      patchedPaths,
    });

    const resolved = resolveOutcome(baseline, patched);
    const installAttempts = [...baseline.installAttempts, ...patched.installAttempts];
    const checks = [
      ...baseline.checks.map((c) => ({ ...c, name: `baseline:${c.name}` })),
      ...patched.checks.map((c) => ({ ...c, name: `patched:${c.name}` })),
    ];

    return {
      status: resolved.status,
      outcome: resolved.status,
      failureCode: resolved.failureCode,
      error: resolved.error,
      installAttempts,
      checks,
      baseline,
      patched,
    };
  } catch (err) {
    return {
      status: "failed",
      outcome: "failed",
      failureCode: "CHECK_FAILED",
      error: err instanceof Error ? err.message : "Repository verification failed.",
      installAttempts: [],
      checks: [],
    };
  } finally {
    await removeWorkspace(workspace.root).catch(() => {});
  }
}
