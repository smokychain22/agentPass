import type { FindingsPayload } from "@/lib/findings/types";
import {
  isCleanupEligibleAudit,
  type CandidateAuditRecord,
} from "@/lib/execution/candidate-lifecycle";
import type { ChangeOperation } from "@/lib/patch-kit/canonical-patch";
import type { PatchKitSummary } from "./types";
import type { RepositoryVerificationResult } from "./repository-verification";

/** Single authoritative metrics object for all UI, reports, and PR bodies. */
export interface AuthoritativeCleanupRunSummary {
  detectedFindings: number;
  preflightCheckedFindings: number;
  eligibleFindings: number;
  ineligibleFindings: number;
  executedFindings: number;
  generatedOperations: number;
  contentValidatedOperations: number;
  gitValidatedOperations: number;
  verifiedOperations: number;
  deliveredOperations: number;
  noChangeExecutions: number;
  failedExecutions: number;
  reviewRequiredFindings: number;
  protectedFindings: number;
  editedPaths: string[];
  deletedPaths: string[];
  addedPaths: string[];
}

export interface CleanupRunSummary extends AuthoritativeCleanupRunSummary {
  /** @deprecated use detectedFindings */
  detected: number;
  /** @deprecated use eligibleFindings */
  eligible: number;
  /** @deprecated use executedFindings */
  executed: number;
  /** @deprecated use executedFindings */
  attempted: number;
  /** @deprecated use generatedOperations */
  generated: number;
  /** @deprecated use contentValidatedOperations */
  validated: number;
  /** @deprecated use verifiedOperations */
  verified: number;
  /** @deprecated use deliveredOperations */
  delivered: number;
  /** @deprecated use noChangeExecutions */
  noOp: number;
  /** @deprecated use failedExecutions */
  failed: number;
  /** @deprecated use protectedFindings */
  protected: number;
  /** @deprecated use reviewRequiredFindings */
  reviewRequired: number;
  notAttempted: number;
  ineligible?: number;
  preflightChecked?: number;
}

function uniquePaths(ops: ChangeOperation[]): string[] {
  return [...new Set(ops.map((op) => op.filePath))];
}

export function buildAuthoritativeCleanupRunSummary(input: {
  findings: FindingsPayload;
  summary: PatchKitSummary;
  candidateAudits?: CandidateAuditRecord[];
  changeOperations?: ChangeOperation[];
  verification?: RepositoryVerificationResult | null;
  patchValidationStatus?: PatchKitSummary["patchValidationStatus"];
  pullRequestUrl?: string;
}): AuthoritativeCleanupRunSummary {
  const scanDetected =
    input.findings.summary.detectedFindings ??
    input.findings.summary.verifiedFindings ??
    input.findings.summary.totalFindings ??
    0;

  const auditDetected = input.candidateAudits
    ? new Set(input.candidateAudits.map((a) => a.findingId)).size
    : 0;

  const ops = input.changeOperations ?? [];
  const operationFindingCount = new Set(
    ops.flatMap((op) => op.findingIds).filter(Boolean)
  ).size;

  const detectedFindings = Math.max(scanDetected, auditDetected, operationFindingCount);

  const preflightCheckedFindings =
    input.candidateAudits?.length ?? input.summary.preflightCheckedFindings ?? detectedFindings;

  const eligibleFindings = input.candidateAudits
    ? input.candidateAudits.filter(isCleanupEligibleAudit).length
    : (input.summary.eligibleFindings ?? 0);

  const ineligibleFindings = Math.max(0, preflightCheckedFindings - eligibleFindings);

  const executedFindings = input.candidateAudits
    ? input.candidateAudits.filter((a) => a.transformAttempted && isCleanupEligibleAudit(a)).length
    : (input.summary.executedFindings ?? 0);

  const editedPaths = ops.filter((o) => o.type === "edit").map((o) => o.filePath);
  const deletedPaths = ops.filter((o) => o.type === "delete").map((o) => o.filePath);
  const addedPaths = ops.filter((o) => o.type === "add").map((o) => o.filePath);
  const generatedOperations =
    ops.length > 0 ? uniquePaths(ops).length : (input.summary.generatedChanges ?? 0);

  const patchStatus = input.patchValidationStatus ?? input.summary.patchValidationStatus;
  const contentValidatedOperations =
    patchStatus === "passed" || patchStatus === "blocked" || patchStatus === "pending_sandbox"
      ? generatedOperations
      : 0;
  const gitValidatedOperations = patchStatus === "passed" ? generatedOperations : 0;

  const verifiedOperations =
    input.verification?.status === "verified" ? generatedOperations : 0;

  const deliveredOperations =
    input.pullRequestUrl && verifiedOperations > 0 ? verifiedOperations : 0;

  const noChangeExecutions = input.candidateAudits
    ? input.candidateAudits.filter(
        (a) => a.transformAttempted && a.blockerCode === "transform_noop"
      ).length
    : (input.summary.noopTransformations ?? 0);

  const failedExecutions = input.candidateAudits
    ? input.candidateAudits.filter(
        (a) =>
          a.transformAttempted &&
          !a.retained &&
          a.blockerCode !== "transform_noop" &&
          a.blockerCode !== "not_attempted"
      ).length
    : (input.summary.failedExecutions ?? 0);

  const rawReview = input.findings.summary.reviewRequired ?? 0;
  const uniqueReview = input.findings.riskBuckets.reviewFirst.length ?? 0;
  const reviewRequiredFindings = Math.min(rawReview, uniqueReview || rawReview);

  const protectedFindings =
    input.findings.summary.doNotTouch ??
    input.findings.riskBuckets.doNotTouch.length ??
    0;

  return {
    detectedFindings,
    preflightCheckedFindings,
    eligibleFindings,
    ineligibleFindings,
    executedFindings,
    generatedOperations,
    contentValidatedOperations,
    gitValidatedOperations,
    verifiedOperations,
    deliveredOperations,
    noChangeExecutions,
    failedExecutions,
    reviewRequiredFindings,
    protectedFindings,
    editedPaths,
    deletedPaths,
    addedPaths,
  };
}

export function buildCleanupRunSummary(input: {
  findings: FindingsPayload;
  summary: PatchKitSummary;
  candidateAudits?: CandidateAuditRecord[];
  changeOperations?: ChangeOperation[];
  verification?: RepositoryVerificationResult | null;
  patchValidationStatus?: PatchKitSummary["patchValidationStatus"];
  pullRequestUrl?: string;
}): CleanupRunSummary {
  const auth = buildAuthoritativeCleanupRunSummary(input);
  const notAttempted = input.summary.notAttempted ?? 0;

  return {
    ...auth,
    detected: auth.detectedFindings,
    preflightChecked: auth.preflightCheckedFindings,
    eligible: auth.eligibleFindings,
    ineligible: auth.ineligibleFindings,
    executed: auth.executedFindings,
    attempted: auth.executedFindings,
    generated: auth.generatedOperations,
    validated: auth.contentValidatedOperations,
    verified: auth.verifiedOperations,
    delivered: auth.deliveredOperations,
    noOp: auth.noChangeExecutions,
    failed: auth.failedExecutions,
    protected: auth.protectedFindings,
    reviewRequired: auth.reviewRequiredFindings,
    notAttempted,
  };
}
