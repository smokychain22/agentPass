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

export function buildVerificationGateReport(
  patchKit: PatchKitPayload,
  findings?: FindingsPayload
): VerificationGateReport {
  const baseline = patchKit.repositoryVerification?.baseline as
    | { checks?: Array<{ name: string; status: string }> }
    | undefined;
  const patched = patchKit.repositoryVerification?.patched as
    | { checks?: Array<{ name: string; status: string }> }
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
      status: checkStatusFromScript(checkList, "test", repoVerified),
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
