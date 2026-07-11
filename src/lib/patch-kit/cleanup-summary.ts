import type { FindingsPayload } from "@/lib/findings/types";
import {
  isCleanupEligibleAudit,
  type CandidateAuditRecord,
} from "@/lib/execution/candidate-lifecycle";
import type { PatchKitSummary } from "./types";
import type { RepositoryVerificationResult } from "./repository-verification";

export interface CleanupRunSummary {
  detected: number;
  preflightChecked?: number;
  eligible: number;
  ineligible?: number;
  executed: number;
  /** @deprecated Use executed */
  attempted: number;
  generated: number;
  validated: number;
  verified: number;
  delivered: number;
  noOp: number;
  failed: number;
  protected: number;
  reviewRequired: number;
  notAttempted: number;
}

export function buildCleanupRunSummary(input: {
  findings: FindingsPayload;
  summary: PatchKitSummary;
  candidateAudits?: CandidateAuditRecord[];
  verification?: RepositoryVerificationResult | null;
  pullRequestUrl?: string;
}): CleanupRunSummary {
  const detected =
    input.findings.summary.detectedFindings ??
    input.findings.summary.verifiedFindings ??
    input.findings.summary.totalFindings ??
    0;

  const eligible = input.candidateAudits
    ? input.candidateAudits.filter(isCleanupEligibleAudit).length
    : (input.summary.eligibleFindings ?? 0);
  const ineligible = input.summary.ineligibleFindings ?? Math.max(0, detected - eligible);
  const executed = input.candidateAudits
    ? input.candidateAudits.filter((a) => a.transformAttempted && isCleanupEligibleAudit(a)).length
    : (input.summary.executedFindings ?? input.summary.attemptedTransformations ?? 0);
  const attempted = executed;
  const generated = input.summary.generatedChanges ?? 0;
  const validated =
    input.summary.patchValidationStatus === "passed" ? input.summary.validatedChanges ?? 0 : 0;
  const verified =
    input.verification?.status === "verified" ? input.summary.verifiedChanges ?? 0 : 0;
  const noOp = input.summary.noopTransformations ?? 0;
  const failed = input.summary.failedTransformations ?? 0;
  const notAttempted = input.summary.notAttempted ?? 0;
  const reviewRequired =
    input.findings.summary.reviewRequired ??
    input.findings.riskBuckets.reviewFirst.length ??
    0;
  const protectedCount =
    input.findings.summary.doNotTouch ??
    input.findings.riskBuckets.doNotTouch.length ??
    0;
  const delivered =
    input.pullRequestUrl && verified > 0
      ? verified
      : input.verification?.status === "verified" && verified > 0
        ? verified
        : 0;

  return {
    detected,
    preflightChecked: input.summary.preflightCheckedFindings ?? detected,
    eligible,
    ineligible,
    executed,
    attempted,
    generated,
    validated,
    verified,
    delivered,
    noOp,
    failed,
    protected: protectedCount,
    reviewRequired,
    notAttempted,
  };
}
