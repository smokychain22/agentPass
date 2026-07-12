import type { Finding } from "@/lib/findings/types";
import type { BaselineVerificationReport } from "./baseline-verification";
import type { VerifyCheckResult } from "@/lib/jobs/types";
import {
  deriveAttemptProductOutcome,
  formatProductOutcomeLabel,
  type ProductOutcome,
} from "./outcomes";

export type CandidateState =
  | "eligible"
  | "attempting"
  | "retained"
  | "rejected"
  | "skipped"
  | "not_attempted";

export interface CandidateDecisionRecord {
  candidateId: string;
  findingId: string;
  pluginId: string;
  strategyId?: string;
  state: CandidateState;
  actionability?: string;
  eligibilityEvidence: Record<string, unknown>;
  generatedChange?: {
    originalHash?: string;
    modifiedHash?: string;
    changedFiles: string[];
    unifiedDiff: string;
    additions: number;
    deletions: number;
  };
  patchValidation?: { status: string; error?: string };
  baseline?: BaselineVerificationReport;
  modified?: BaselineVerificationReport;
  comparison?: Array<{ name: string; outcome: string; exitCode: number | null }>;
  verificationComparison?: Array<{ name: string; outcome: string; exitCode: number | null }>;
  /** Internal attempt result — not shown as primary user label */
  finalDecision: "retained" | "skipped" | "rejected";
  /** Precise user-facing outcome */
  productOutcome: ProductOutcome;
  exactReason: string;
  rejectionReason: string;
  rollbackStatus: "completed" | "not_needed" | "failed" | "pending";
  checks: VerifyCheckResult[];
}

export function formatRejectionReason(input: {
  status: string;
  reason: string;
  productOutcome?: ProductOutcome;
  comparison?: Array<{ name: string; outcome: string }>;
  patchValidation?: { error?: string };
  rollbackStatus?: string;
}): string {
  if (input.status === "retained") {
    return "Generated; pending Git validation and repository verification.";
  }

  const outcome =
    input.productOutcome ??
    deriveAttemptProductOutcome({
      internalStatus: input.status as "retained" | "skipped" | "rejected",
      reason: input.reason,
      pluginId: "",
      comparison: input.comparison,
    });

  const raw = input.reason.trim();

  if (outcome === "rolled_back_regression") {
    const checks =
      raw.replace("Verification introduced new failure in: ", "") ||
      input.comparison
        ?.filter((c) => c.outcome.toLowerCase().includes("new regression"))
        .map((c) => c.name)
        .join(", ");
    return formatProductOutcomeLabel("rolled_back_regression", checks || "regression");
  }

  if (outcome === "blocked_dynamic_usage") {
    return formatProductOutcomeLabel(
      "blocked_dynamic_usage",
      raw.includes("JSX") || raw.includes("jsx") ? "symbol referenced in JSX" : undefined
    );
  }

  if (raw && raw !== "No safe fix retained — see verification details") {
    if (raw === "No diff was generated for this fix.") {
      return formatProductOutcomeLabel("unsupported_transformation");
    }
    if (raw.includes("Patch validation failed") || input.patchValidation?.error) {
      return `${formatProductOutcomeLabel("unsupported_transformation")}: ${input.patchValidation?.error ?? raw}`;
    }
    if (outcome !== "unsupported_transformation") {
      return formatProductOutcomeLabel(outcome, raw);
    }
    return raw;
  }

  const introduced = input.comparison?.filter((c) =>
    c.outcome.toLowerCase().includes("new regression")
  );
  if (introduced?.length) {
    return formatProductOutcomeLabel(
      "rolled_back_regression",
      introduced.map((c) => c.name).join(", ")
    );
  }

  if (input.rollbackStatus === "completed") {
    return formatProductOutcomeLabel("rolled_back_regression");
  }

  return formatProductOutcomeLabel("unsupported_transformation");
}

export function buildEligibilityEvidence(finding: Finding): Record<string, unknown> {
  return {
    findingId: finding.id,
    type: finding.type,
    title: finding.title,
    action: finding.action,
    confidence: finding.confidence,
    source: finding.source,
    sourceMode: finding.sourceMode,
    files: finding.files,
    evidence: finding.evidence,
  };
}
