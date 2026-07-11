import type { CandidateAuditRecord } from "@/lib/execution/candidate-lifecycle";
import type { FreeCleanupResult } from "@/lib/execution/run-cleanup-core";
import type { PatchKitSummary } from "@/lib/patch-kit/types";
import type { FindingsPayload } from "@/lib/findings/types";

export type ProofLadderStage =
  | "detected"
  | "eligible"
  | "attempted"
  | "generated"
  | "validated"
  | "verified"
  | "delivered";

export interface ProofLadderCounts {
  detected: number;
  eligible: number;
  attempted: number;
  generated: number;
  validated: number;
  verified: number;
  delivered: number;
  noop: number;
  failed: number;
  notAttempted: number;
  rejectedForSafety: number;
}

export interface CleanupProof {
  scanId: string;
  commitSha: string;
  verifiedFindings: number;
  eligibleTransformations: number;
  generatedChanges: number;
  validatedChanges: number;
  verificationStatus: "passed" | "failed" | "partial" | "not_run" | "pending";
  pullRequestUrl?: string;
  proof: {
    filesEdited: number;
    filesDeleted: number;
    filesAdded: number;
    linesAdded: number;
    linesRemoved: number;
    protectedFilesChanged: number;
    patchValidationStatus: string;
  };
  ladder: ProofLadderCounts;
}

export function buildProofLadderCounts(input: {
  findings?: FindingsPayload | null;
  summary: PatchKitSummary;
  verificationStatus?: CleanupProof["verificationStatus"];
  pullRequestUrl?: string;
}): ProofLadderCounts {
  const detected =
    input.findings?.summary.detectedFindings ??
    input.findings?.summary.verifiedFindings ??
    input.findings?.summary.totalFindings ??
    0;

  const eligible = input.summary.eligibleFindings ?? input.summary.transformerCompatible ?? 0;
  const attempted = input.summary.attemptedTransformations ?? 0;
  const generated = input.summary.generatedChanges ?? 0;
  const validated = input.summary.validatedChanges ?? 0;
  const verified = input.summary.verifiedChanges ?? 0;
  const noop = input.summary.noopTransformations ?? 0;
  const failed = input.summary.failedTransformations ?? 0;
  const notAttempted = input.summary.notAttempted ?? 0;
  const rejectedForSafety = Math.max(0, detected - eligible);

  const delivered =
    input.pullRequestUrl && validated > 0
      ? validated
      : input.verificationStatus === "passed" && validated > 0
        ? validated
        : 0;

  return {
    detected,
    eligible,
    attempted,
    generated,
    validated,
    verified,
    delivered,
    noop,
    failed,
    notAttempted,
    rejectedForSafety,
  };
}

export function buildCleanupProof(input: {
  findings: FindingsPayload;
  summary: PatchKitSummary;
  patchLines?: { added: number; removed: number };
  verificationStatus?: CleanupProof["verificationStatus"];
  pullRequestUrl?: string;
}): CleanupProof {
  const ladder = buildProofLadderCounts({
    findings: input.findings,
    summary: input.summary,
    verificationStatus: input.verificationStatus,
    pullRequestUrl: input.pullRequestUrl,
  });

  return {
    scanId: input.findings.scanId,
    commitSha: input.findings.repo.commitSha ?? "unknown",
    verifiedFindings: input.findings.summary.verifiedFindings ?? ladder.detected,
    eligibleTransformations: ladder.eligible,
    generatedChanges: ladder.generated,
    validatedChanges: ladder.validated,
    verificationStatus: input.verificationStatus ?? "pending",
    pullRequestUrl: input.pullRequestUrl,
    proof: {
      filesEdited: input.summary.filesEdited ?? 0,
      filesDeleted: input.summary.filesDeleted ?? 0,
      filesAdded: input.summary.filesAdded ?? 0,
      linesAdded: input.patchLines?.added ?? 0,
      linesRemoved: input.patchLines?.removed ?? 0,
      protectedFilesChanged: 0,
      patchValidationStatus: input.summary.patchValidationStatus ?? "not_generated",
    },
    ladder,
  };
}

function countAuditMetrics(audits: CandidateAuditRecord[]) {
  const eligible = audits.filter((a) => a.scanEligible).length;
  const attempted = audits.filter((a) => a.transformAttempted).length;
  const generated = audits.filter(
    (a) => a.contentChanged || a.proposedSourceChanged || a.proposedDiffGenerated
  ).length;
  const validated = audits.filter((a) => a.patchValidated).length;
  const verified = audits.filter((a) => a.retained).length;
  const noop = audits.filter((a) => a.blockerCode === "transform_noop").length;
  const failed = audits.filter(
    (a) =>
      a.transformAttempted &&
      !a.retained &&
      a.blockerCode &&
      a.blockerCode !== "transform_noop" &&
      a.blockerCode !== "not_attempted"
  ).length;
  const notAttempted = audits.filter((a) => a.blockerCode === "not_attempted").length;

  return { eligible, attempted, generated, validated, verified, noop, failed, notAttempted };
}

export function buildPatchKitSummaryFromCleanupResult(
  cleanup: FreeCleanupResult,
  findings: FindingsPayload
): PatchKitSummary {
  const audits = cleanup.candidateAudits ?? [];
  const metrics = countAuditMetrics(audits);
  const deletedPaths = cleanup.fileChanges
    .filter((fc) => cleanup.proof.changedFiles.includes(fc.path))
    .map((fc) => fc.path);

  return {
    safeDeleteCandidates: metrics.eligible,
    transformerCompatible: metrics.eligible,
    eligibleFindings: metrics.eligible,
    dryRunPassed: metrics.validated,
    attemptedTransformations: metrics.attempted || cleanup.fixLoop.evaluated,
    noopTransformations: metrics.noop,
    failedTransformations: metrics.failed,
    notAttempted: cleanup.fixLoop.notAttempted || metrics.notAttempted,
    generatedChanges: metrics.generated,
    validatedChanges: metrics.validated || (cleanup.patchStatus === "validated" ? metrics.verified : 0),
    verifiedChanges: cleanup.fixLoop.verified,
    filesEdited: cleanup.metrics.filesChanged,
    filesDeleted: deletedPaths.length,
    filesAdded: 0,
    rawReviewFindings: findings.summary.reviewRequired,
    reviewFirstItems: findings.riskBuckets.reviewFirst.length,
    doNotTouchItems: findings.riskBuckets.doNotTouch.length,
    packageSuggestions: findings.unused.dependencies.length,
    patchLines: cleanup.proof.linesAdded + cleanup.proof.linesRemoved,
    regressionChecks: cleanup.verification.checks.length,
    bundleFileCount: 0,
    patchValidationStatus:
      cleanup.patchValidation?.status === "passed"
        ? "passed"
        : cleanup.patchStatus === "validated"
          ? "passed"
          : cleanup.patchStatus === "failed"
            ? "failed"
            : "not_generated",
    detectedSignals:
      findings.summary.detectedFindings ??
      findings.summary.verifiedFindings ??
      findings.summary.totalFindings,
    blockerSummary: cleanup.blockerBreakdown,
  };
}

export function buildCleanupProofFromRun(input: {
  findings: FindingsPayload;
  cleanup: FreeCleanupResult;
  pullRequestUrl?: string;
}): CleanupProof {
  const summary = buildPatchKitSummaryFromCleanupResult(input.cleanup, input.findings);
  const verificationStatus =
    input.pullRequestUrl && summary.validatedChanges > 0
      ? "passed"
      : input.cleanup.verification.status;

  summary.proofLadder = buildProofLadderCounts({
    findings: input.findings,
    summary,
    verificationStatus,
    pullRequestUrl: input.pullRequestUrl,
  });

  return buildCleanupProof({
    findings: input.findings,
    summary,
    patchLines: {
      added: input.cleanup.proof.linesAdded,
      removed: input.cleanup.proof.linesRemoved,
    },
    verificationStatus,
    pullRequestUrl: input.pullRequestUrl,
  });
}

export function formatProofLadderSummary(ladder: ProofLadderCounts): string {
  return [
    `${ladder.detected} signals detected`,
    `${ladder.eligible} eligible transformations`,
    `${ladder.attempted} transformer attempts`,
    `${ladder.generated} changes generated`,
    `${ladder.validated} patches validated`,
    `${ladder.verified} changes verified`,
    ladder.delivered > 0 ? `${ladder.delivered} delivered via PR` : null,
    ladder.noop > 0 ? `${ladder.noop} no-op` : null,
    ladder.failed > 0 ? `${ladder.failed} failed` : null,
    ladder.notAttempted > 0 ? `${ladder.notAttempted} not attempted (limit)` : null,
    ladder.rejectedForSafety > 0 ? `${ladder.rejectedForSafety} review-first or protected` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
