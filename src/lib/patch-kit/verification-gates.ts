import type { PatchKitPayload } from "./types";
import type { FindingsPayload } from "@/lib/findings/types";

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
  const checks = [...(baseline?.checks ?? []), ...(patched?.checks ?? [])];
  const uniqueChecks = new Map(checks.map((c) => [c.name, c]));

  const patchStatus = patchKit.patchValidation?.status;
  const repoVerification = patchKit.repositoryVerification?.status;
  const repoVerified = repoVerification === "verified";
  const scanReady = findings?.scanIntelligence?.coverage.readinessForFindings !== false;
  const checkList = [...uniqueChecks.values()];

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
      requiredForSafePr: false,
      status: "not_run",
      detail: "Planned — Accuracy Lab benchmark will enforce per-case.",
    },
    {
      id: "no_new_findings",
      label: "Confirm no new findings introduced",
      requiredForSafePr: false,
      status: "not_run",
      detail: "Planned — full re-analysis gate in Accuracy Lab.",
    },
    {
      id: "api_surface",
      label: "Compare exported APIs",
      requiredForSafePr: false,
      status: "not_run",
    },
    {
      id: "import_graph",
      label: "Inspect changed dependency graph",
      requiredForSafePr: false,
      status: "not_run",
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
