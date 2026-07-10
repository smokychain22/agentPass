import type { Finding } from "@/lib/findings/types";
import type { BaselineVerificationReport } from "./baseline-verification";
import type { VerifyCheckResult } from "@/lib/jobs/types";

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
  state: CandidateState;
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
  finalDecision: "retained" | "skipped" | "rejected";
  rejectionReason: string;
  rollbackStatus: "completed" | "not_needed" | "failed" | "pending";
  checks: VerifyCheckResult[];
}

export function formatRejectionReason(input: {
  status: string;
  reason: string;
  comparison?: Array<{ name: string; outcome: string }>;
  patchValidation?: { error?: string };
  rollbackStatus?: string;
}): string {
  if (input.status === "retained") {
    return "Fix verified and retained — all required checks passed or showed no new regression.";
  }

  const raw = input.reason.trim();
  if (raw && raw !== "No safe fix retained — see verification details") {
    if (raw.startsWith("Verification introduced new failure")) {
      const checks = raw.replace("Verification introduced new failure in: ", "");
      return `Change rolled back because ${checks} introduced new failure(s) after the modification.`;
    }
    if (raw === "No diff was generated for this fix.") {
      return "Change skipped because the fix plugin could not produce a source modification.";
    }
    if (raw.includes("Patch validation failed") || input.patchValidation?.error) {
      return `Change skipped because patch validation failed: ${input.patchValidation?.error ?? raw}`;
    }
    return raw;
  }

  const introduced = input.comparison?.filter((c) =>
    c.outcome.toLowerCase().includes("new regression")
  );
  if (introduced?.length) {
    return `Change rolled back because ${introduced.map((c) => c.name).join(", ")} introduced new failure(s).`;
  }

  if (input.rollbackStatus === "completed") {
    return "Change rolled back after verification did not pass safety requirements.";
  }

  return "RepoDiet refused this modification because it could not prove the change preserved repository behavior.";
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
