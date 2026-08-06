import type { PatchKitPayload } from "./types";
import type { FindingsPayload } from "@/lib/findings/types";
import { formatBuildGateFailureMessage } from "./build-gate-message";

export type VerificationGateStatus = "passed" | "failed" | "skipped" | "not_run" | "partial";

export interface VerificationGate {
  id: string;
  label: string;
  requiredForSafePr: boolean;
  status: VerificationGateStatus;
  detail?: string;
}

export interface VerificationGateReport {
  gates: VerificationGate[];
  allRequiredPassed: boolean;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
}

function checkStatusFromScript(
  checks: Array<{ name: string; status: string }>,
  scriptName: string,
  repoVerified: boolean
): VerificationGateStatus {
  const hit = checks.find((c) => c.name === scriptName);
  if (hit) {
    if (hit.status === "passed") return "passed";
    if (hit.status === "failed") return "failed";
    if (hit.status === "skipped") return "skipped";
    return "partial";
  }
  // Script absent from package.json or not executed — skip if holistic verification passed
  if (repoVerified) return "skipped";
  return "not_run";
}

/** One phase's record of a single named check, as stored on the verification result. */
interface PhaseCheck {
  name: string;
  status: string;
  exitCode?: number | null;
  stdoutSummary?: string;
  stderrSummary?: string;
}

/**
 * Stable identity for a check FAILURE, used only to decide whether the patched
 * tree failed in the *same* way the baseline already did.
 *
 * Deliberately includes the exit code and the normalized output summary, not
 * just the status: two failures that are both merely "failed" can be entirely
 * different breakages, and treating those as equivalent would let a real
 * regression ride in behind a pre-existing one.
 *
 * Normalization strips ANSI codes, absolute workspace paths, digit runs, and
 * collapses whitespace, so the same underlying failure fingerprints identically
 * across two temp directories and two runs with different timings.
 */
function fingerprintCheckFailure(check: PhaseCheck): string {
  const raw = `${check.stderrSummary ?? ""}\n${check.stdoutSummary ?? ""}`;
  const normalized = raw
    .replace(/\[[0-9;]*m/g, "")
    .replace(/[A-Za-z]:[\\/][^\s'"]*/g, "<path>")
    .replace(/\/(?:[\w.-]+\/)+[\w.-]+/g, "<path>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  return `${check.name}:${check.exitCode ?? "null"}:${normalized}`;
}

/**
 * Resolves the required `unit_tests` gate.
 *
 * `runRepositoryVerification` already compares baseline against patched and
 * only requires typecheck/build to pass, so a repository whose suite was
 * ALREADY red before cleanup can legitimately reach `status: "verified"` with
 * `verifiedChanges > 0`. This gate used to read the patched `test` result on
 * its own and fail unconditionally, which refused a safe, approved deletion
 * for a failure the patch did not introduce — observed on funded job 0x22a2…,
 * where `createCleanupPullRequest` then threw NO_SAFE_CANDIDATES.
 *
 * Fail-closed: a pre-existing failure is excused ONLY when the baseline failed
 * with the same fingerprint. A patched-only failure, or a patched failure that
 * differs from the baseline's, still fails the gate and still blocks the PR.
 */
export function resolveUnitTestGate(
  checkList: Array<{ name: string; status: string }>,
  repoVerified: boolean,
  baselineChecks: PhaseCheck[] | undefined,
  patchedChecks: PhaseCheck[] | undefined
): { status: VerificationGateStatus; detail?: string } {
  const status = checkStatusFromScript(checkList, "test", repoVerified);
  if (status !== "failed") return { status };

  const baselineTest = baselineChecks?.find((c) => c.name === "test");
  const patchedTest = patchedChecks?.find((c) => c.name === "test");

  // Without both phases recorded we cannot prove the failure pre-existed.
  if (!baselineTest || !patchedTest) return { status: "failed" };
  if (baselineTest.status !== "failed" || patchedTest.status !== "failed") {
    return { status: "failed" };
  }

  const baselineFingerprint = fingerprintCheckFailure(baselineTest);
  const patchedFingerprint = fingerprintCheckFailure(patchedTest);
  if (baselineFingerprint !== patchedFingerprint) {
    return {
      status: "failed",
      detail:
        "Patched test failure differs from the baseline failure — treated as a new regression.",
    };
  }

  return {
    status: "skipped",
    detail:
      "Pre-existing test failure: the baseline tree already failed `test` identically before cleanup, and the patch did not change it.",
  };
}

export function buildVerificationGateReport(
  patchKit: PatchKitPayload,
  findings?: FindingsPayload
): VerificationGateReport {
  const baseline = patchKit.repositoryVerification?.baseline as
    | { checks?: PhaseCheck[] }
    | undefined;
  const patched = patchKit.repositoryVerification?.patched as
    | { checks?: PhaseCheck[] }
    | undefined;
  // Prefer patched-phase statuses; keep baseline when a check is absent from patched.
  const uniqueChecks = new Map<string, { name: string; status: string }>();
  for (const check of baseline?.checks ?? []) uniqueChecks.set(check.name, check);
  for (const check of patched?.checks ?? []) uniqueChecks.set(check.name, check);

  const patchStatus = patchKit.patchValidation?.status;
  const repoVerification = patchKit.repositoryVerification?.status;
  const repoVerified = repoVerification === "verified";
  const scanReady = findings?.scanIntelligence?.coverage.readinessForFindings !== false;
  const checkList = [...uniqueChecks.values()];
  const postPatch = patchKit.postPatchVerification;
  const postPatchRan = Boolean(postPatch && postPatch.status !== "not_run");
  const apiDiff = patchKit.apiSurfaceDiff;
  const graphDiff = patchKit.importGraphDiff;

  const gates: VerificationGate[] = [
    {
      id: "minimal_diff",
      label: "Apply smallest possible diff",
      requiredForSafePr: true,
      status:
        (patchKit.summary.validatedChanges ?? 0) > 0 || (patchKit.summary.filesDeleted ?? 0) > 0
          ? "passed"
          : "not_run",
      detail: `${patchKit.summary.validatedChanges ?? 0} validated operations`,
    },
    {
      id: "patch_git_apply",
      label: "Patch applies cleanly to pinned commit",
      requiredForSafePr: true,
      status: patchStatus === "passed" ? "passed" : patchStatus === "failed" ? "failed" : "not_run",
      detail: patchKit.patchValidation?.error,
    },
    {
      id: "scan_coverage",
      label: "Structure scan coverage complete",
      requiredForSafePr: true,
      status: scanReady ? "passed" : findings?.scanCoverageWarning ? "failed" : "skipped",
      detail: findings?.scanCoverageWarning,
    },
    {
      id: "dependency_install",
      label: "Install dependencies successfully",
      requiredForSafePr: true,
      status:
        repoVerified
          ? "passed"
          : repoVerification === "regression_failed" || repoVerification === "failed"
            ? "failed"
            : patchKit.repositoryVerification?.installAttempts?.length
              ? "partial"
              : "not_run",
    },
    {
      id: "typecheck",
      label: "Run type checking",
      requiredForSafePr: true,
      status: checkStatusFromScript(checkList, "typecheck", repoVerified),
    },
    {
      id: "lint",
      label: "Run linting",
      requiredForSafePr: false,
      status: checkStatusFromScript(checkList, "lint", repoVerified),
    },
    {
      id: "unit_tests",
      label: "Run unit tests",
      requiredForSafePr: true,
      ...resolveUnitTestGate(checkList, repoVerified, baseline?.checks, patched?.checks),
    },
    {
      id: "production_build",
      label: "Run production build",
      requiredForSafePr: true,
      status: checkStatusFromScript(checkList, "build", repoVerified),
      detail: (() => {
        const buildStatus = checkStatusFromScript(checkList, "build", repoVerified);
        if (buildStatus === "passed") return undefined;
        return formatBuildGateFailureMessage(patchKit, findings);
      })(),
    },
    {
      id: "baseline_patched",
      label: "Baseline and patched verification phases",
      requiredForSafePr: true,
      status:
        repoVerification === "verified"
          ? "passed"
          : repoVerification === "regression_failed"
            ? "failed"
            : repoVerification === "not_run"
              ? "not_run"
              : "partial",
      detail: patchKit.repositoryVerification?.error,
    },
    {
      id: "verified_changes",
      label: "At least one verified cleanup change",
      requiredForSafePr: true,
      status: (patchKit.summary.verifiedChanges ?? 0) > 0 ? "passed" : "failed",
      detail: `${patchKit.summary.verifiedChanges ?? 0} verified operations`,
    },
    {
      id: "green_remediation_only",
      label: "Auto-applied fixes are Green-tier only",
      requiredForSafePr: true,
      status: patchKit.remediationPlan ? "passed" : "not_run",
      detail: patchKit.remediationPlan
        ? `${patchKit.remediationPlan.summary.greenCount} green (${patchKit.remediationPlan.summary.autoFixEligibleCount} autofix-eligible), ${patchKit.remediationPlan.summary.yellowCount} yellow, ${patchKit.remediationPlan.summary.redCount} red`
        : undefined,
    },
    {
      id: "lockfile_integrity",
      label: "Lockfile integrity (no corrupt install)",
      requiredForSafePr: true,
      status:
        patchKit.repositoryVerification?.failureCode === "INSTALL_FAILED"
          ? "failed"
          : repoVerified
            ? "passed"
            : "not_run",
    },
    {
      id: "detector_rerun",
      label: "Re-run original detector on patched tree",
      requiredForSafePr: postPatchRan,
      status: !postPatch
        ? "not_run"
        : postPatch.status === "not_run"
          ? "not_run"
          : postPatch.status === "partial"
            ? "partial"
            : postPatch.originalFindingsResolved
              ? "passed"
              : "failed",
      detail: postPatch?.detectorReruns.length
        ? `${postPatch.detectorReruns.filter((r) => r.passed).length}/${postPatch.detectorReruns.length} applied findings cleared on re-run`
        : postPatchRan
          ? postPatch?.error
          : "Runs after patch when findings were applied.",
    },
    {
      id: "no_new_findings",
      label: "Confirm no new findings introduced",
      requiredForSafePr: postPatchRan,
      status: !postPatch
        ? "not_run"
        : postPatch.status === "not_run"
          ? "not_run"
          : postPatch.status === "partial"
            ? "partial"
            : postPatch.newFindingCount === 0
              ? "passed"
              : "failed",
      detail: postPatchRan
        ? `${postPatch?.newFindingCount ?? 0} new actionable finding(s) vs baseline (${(postPatch?.newFindingsIntroduced ?? [])
            .slice(0, 3)
            .map((f) => `${f.type}:${(f.files ?? []).join(",") || f.packageName || "?"}`)
            .join("; ") || "none"})`
        : "Full re-analysis on patched tree.",
    },
    {
      id: "api_surface",
      label: "Compare exported APIs",
      requiredForSafePr: false,
      status: apiDiff
        ? apiDiff.breaking
          ? "failed"
          : "passed"
        : "not_run",
      detail: apiDiff
        ? apiDiff.breaking
          ? `Removed exports: ${apiDiff.removedExports.join(", ") || "package.json fields"}`
          : `Exports stable (${apiDiff.addedExports.length} added)`
        : undefined,
    },
    {
      id: "import_graph",
      label: "Inspect changed dependency graph",
      requiredForSafePr: false,
      status: graphDiff
        ? graphDiff.newCycles.length > 0
          ? "failed"
          : "passed"
        : "not_run",
      detail: graphDiff
        ? `Edges ${graphDiff.beforeEdgeCount}→${graphDiff.afterEdgeCount}, cycles ${graphDiff.beforeCycleCount}→${graphDiff.afterCycleCount}`
        : undefined,
    },
  ];

  const required = gates.filter((g) => g.requiredForSafePr);
  const allRequiredPassed = required.every(
    (g) => g.status === "passed" || g.status === "skipped"
  );

  return {
    gates,
    allRequiredPassed,
    passedCount: gates.filter((g) => g.status === "passed").length,
    failedCount: gates.filter((g) => g.status === "failed").length,
    skippedCount: gates.filter((g) => g.status === "skipped" || g.status === "not_run").length,
  };
}
