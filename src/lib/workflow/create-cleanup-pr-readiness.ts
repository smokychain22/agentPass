/**
 * Single authoritative selector for whether the "Create Cleanup PR" stage
 * may be shown/unlocked. Every consumer (top nav, left nav, stage buttons,
 * direct-URL guards, the Create Cleanup PR view itself) must call this
 * instead of computing its own boolean, so they can never disagree.
 */
export interface CreateCleanupPrReadinessInput {
  scanComplete: boolean;
  findingsReady: boolean;
  findingsError: boolean;
  analyzedCommit?: string | null;
  activeCommit?: string | null;
  eligibleSelectedCount: number;
  unresolvedRequiredCount: number;
  /** From GET /api/user-directed/cleanup-plan-status — authoritative, server-computed. */
  planApproved: boolean;
  planCurrent: boolean;
  planSuperseded: boolean;
  githubWriteCapable: boolean;
}

export interface CreateCleanupPrReadiness {
  unlocked: boolean;
  reasons: string[];
}

export function computeCreateCleanupPrReadiness(
  input: CreateCleanupPrReadinessInput
): CreateCleanupPrReadiness {
  const reasons: string[] = [];

  if (!input.scanComplete) reasons.push("Repository analysis is not complete yet.");
  if (input.findingsError) reasons.push("Findings analysis failed — retry analysis first.");
  else if (!input.findingsReady) reasons.push("Findings have not finished analyzing and persisting.");

  if (
    input.analyzedCommit &&
    input.activeCommit &&
    input.analyzedCommit !== input.activeCommit
  ) {
    reasons.push("The analyzed commit no longer matches the active repository.");
  }

  if (input.eligibleSelectedCount < 1) {
    reasons.push("Select at least one finding for cleanup.");
  }
  if (input.unresolvedRequiredCount > 0) {
    reasons.push("Resolve or exclude every finding that needs your decision.");
  }

  if (!input.planApproved) {
    reasons.push("Prepare and approve a cleanup plan.");
  } else if (input.planSuperseded || !input.planCurrent) {
    reasons.push(
      "A decision changed since the plan was approved — prepare and approve the updated plan."
    );
  }

  if (!input.githubWriteCapable) {
    reasons.push("Connect GitHub to create the pull request.");
  }

  return { unlocked: reasons.length === 0, reasons };
}
