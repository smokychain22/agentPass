import fs from "node:fs/promises";
import path from "node:path";
import { execa, type ExecaReturnValue } from "execa";
import { createScanWorkspace, removeWorkspace } from "@/lib/server/workspace";
import { detectPackageManager } from "@/lib/scanner/detect-package-manager";
import type { VerifyCheckResult } from "@/lib/jobs/types";
import { copyRepoBaseline } from "./generate-unified-diff";
import { dedupeConsolidatedEdits, type ConsolidatedEdit } from "./merge-patches";
import {
  describeProcessTermination,
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
import { buildUntrustedSandboxEnv } from "@/lib/sandbox/secret-firewall";
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

/** The PRODUCTION default. Unchanged by this fix — see describeProcessTermination wiring below. */
export const PRODUCTION_COMMAND_TIMEOUT_MS = 180_000;
/**
 * Resolved per call, matching the identical pattern in run-verification.ts
 * and baseline-verification.ts, both of which already read this same env
 * var. This file never wired it in, so it was silently ignored here —
 * production is unaffected (the var is unset there), but tests can now
 * exercise a real, fast timeout instead of waiting on the 180s default.
 */
function commandTimeoutMs(): number {
  const o = Number(process.env.REPODIET_VERIFY_COMMAND_TIMEOUT_MS);
  return Number.isFinite(o) && o > 0 ? o : PRODUCTION_COMMAND_TIMEOUT_MS;
}
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
  // Strip platform secrets before customer install/build/test scripts.
  const sandboxed = buildUntrustedSandboxEnv(process.env);
  return {
    ...sandboxed,
    CI: "true",
    FORCE_COLOR: "0",
    NODE_ENV: scriptName === "build" ? "production" : "test",
    PATH: `${localBin}${path.delimiter}${sandboxed.PATH ?? pathEnv}`,
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
  const result = await execa(primary[0], primary.slice(1), {
    cwd: rootDir,
    timeout: commandTimeoutMs(),
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
        timeout: commandTimeoutMs(),
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
        timeout: commandTimeoutMs(),
        reject: false,
        env: verificationEnv(rootDir, "build"),
      });
    } catch {
      return result;
    }
  }

  return result;
}

/** Normalizes and de-duplicates repository-relative paths for verification. */
function uniqueVerificationPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paths) {
    const normalized = raw.replace(/\\/g, "/").replace(/^\.\//, "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/**
 * Removes exactly the delivery-scoped deletions from the patched tree.
 *
 * Path containment is enforced against the patched root: a candidate path is
 * analyzer output, and a `..` traversal must never be able to delete outside
 * the verification workspace. An already-absent path is not an error — the
 * post-condition ("this file is gone") already holds.
 */
async function applyScopedDeletes(rootDir: string, deletePaths: string[]): Promise<void> {
  const root = path.resolve(rootDir);
  for (const relative of deletePaths) {
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`refusing to delete outside the verification workspace: ${relative}`);
    }
    await fs.rm(target, { force: true, recursive: true });
  }
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
    /**
     * Incident #35 follow-up: this loop has its own commandTimeoutMs() bound
     * (execa `timeout` + `reject: false`), separate from workspace-install's
     * install bound, and previously reported a killed typecheck/build the
     * same way PR #184 fixed for installs — raw truncated stdout/stderr, read
     * cold as a real compile failure ("Baseline repository already fails
     * verification") when it was actually terminated before finishing.
     * `describeProcessTermination` already carries the timeout/OOM/SIGTERM
     * table; it just wasn't wired in here.
     */
    const termination = describeProcessTermination(
      { exitCode: result.exitCode ?? null, signal: result.signal ?? null, timedOut: result.timedOut ?? false },
      `Verification command "${name}"`
    );
    checks.push({
      name,
      command: command.join(" "),
      status: result.exitCode === 0 ? "passed" : "failed",
      exitCode: result.exitCode ?? null,
      durationMs: Date.now() - t0,
      stdoutSummary: summarize(result.stdout ?? ""),
      stderrSummary: termination ?? summarize(result.stderr ?? ""),
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

/** Baseline-only verification for pre-quote readiness (no patch applied). */
export async function runBaselineOnlyVerification(input: {
  baselineRoot: string;
  cleanupRunId: string;
}): Promise<RepositoryVerificationPhaseResult> {
  const pkgPath = path.join(input.baselineRoot, "package.json");
  const hasPackageJson = await fs.access(pkgPath).then(() => true).catch(() => false);
  if (!hasPackageJson) {
    return {
      phase: "baseline",
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

  return runVerificationPhase({
    rootDir: input.baselineRoot,
    cleanupRunId: input.cleanupRunId,
    phase: "baseline",
  });
}

export async function runRepositoryVerification(input: {
  baselineRoot: string;
  edits: ConsolidatedEdit[];
  cleanupRunId: string;
  patch?: string;
  /**
   * === Delivery scope (the exact tree the customer would receive) ===
   *
   * When present, verification is DELIVERY-SCOPED: the patched tree is built
   * from `edits` plus exactly these deletions, and the broad `patch` is
   * deliberately ignored.
   *
   * Why this exists: verification used to run against the whole analyzer
   * candidate set via `patch` (the merged patch), while the approval/delivery
   * filter ran later, in `createCleanupPullRequest`. So an analyzer false
   * positive that was NEVER going to be delivered still got applied to the
   * verified tree, failed the repository's own tests, drove `verifiedChanges`
   * to 0, and blocked delivery of an unrelated, genuinely-safe approved
   * candidate.
   *
   * Observed on repodiet-agent-9636 against velz-cmd/repodiet-e2e-test: the
   * kit proposed deleting `src/config/runtime-hook.ts` (referenced
   * dynamically through `fixture.config.json`, so a genuine false positive).
   * The approved candidate was `src/repodiet-verification-unused.js`, which is
   * genuinely unreferenced. Verification applied BOTH, the repository's own
   * `dynamic, side-effect, config, package-export and asset references stay
   * alive` test failed, and no PR could ever be produced. The base branch's
   * own tests pass cleanly, so this was not a pre-existing failure.
   *
   * This does not weaken anything. A false positive that IS selected for
   * delivery is still applied here and still fails closed against the
   * repository's own tests — see the Case B regression. What changes is only
   * that an UNSELECTED candidate can no longer invalidate the deliverable.
   */
  deletePaths?: string[];
}): Promise<RepositoryVerificationResult> {
  const deduped = dedupeConsolidatedEdits(input.edits);
  const deliveryScoped = input.deletePaths !== undefined;
  const scopedDeletes = uniqueVerificationPaths(input.deletePaths ?? []);

  // A delivery that is ONLY deletions is a real deliverable and must be
  // verified. Keying "nothing to do" off edits alone would silently skip
  // verification for exactly the shape this fix exists to support.
  if (deduped.length === 0 && scopedDeletes.length === 0) {
    return { status: "not_run", installAttempts: [], checks: [] };
  }

  const workspace = await createScanWorkspace("repo-verify");
  const baselineRoot = path.join(workspace.artifactsPath, "baseline");
  const patchedRoot = path.join(workspace.artifactsPath, "patched");
  const patchedPaths = [
    ...deduped.map((edit) => edit.path.replace(/\\/g, "/")),
    ...scopedDeletes,
  ];

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
    if (deliveryScoped) {
      // EXACTLY the delivery operations — never the broad candidate patch.
      await applyPatchOrEdits(patchedRoot, undefined, deduped);
      await applyScopedDeletes(patchedRoot, scopedDeletes);
    } else {
      await applyPatchOrEdits(patchedRoot, input.patch, deduped);
    }

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
