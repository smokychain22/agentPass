import type { GitHubClient } from "@/lib/github/github-client";

export interface PrRepairContext {
  owner: string;
  repo: string;
  cleanupBranch: string;
  /** The PR number from a prior attempt on this same paid task, if any. */
  existingPrNumber?: number;
}

export type PrRepairAction =
  | "create_new_branch_and_pr"
  | "reuse_existing_branch_and_pr"
  | "replacement_required";

export interface PrRepairResolution {
  action: PrRepairAction;
  branchExists: boolean;
  existingPr?: { number: number; url: string; state: string };
  /** Plain-language reason, safe to surface to the user (Part 12F: always explain why a replacement was required). */
  reason: string;
}

/**
 * Command 3E, Part 12D/12E/12F — decides how to deliver a retry for an
 * already-paid task: reuse the same branch+PR when it is still usable
 * (Part 12E "Existing PR can be repaired"), or fall back to a fresh
 * branch+PR only when the original is genuinely unusable — deleted,
 * closed, or otherwise inaccessible (Part 12F "Original PR cannot be
 * used"). Never creates a second PR merely because a check failed.
 */
export async function resolvePrRepairStrategy(
  client: GitHubClient,
  ctx: PrRepairContext
): Promise<PrRepairResolution> {
  let branchExists = false;
  try {
    await client.getBranchSha(ctx.owner, ctx.repo, ctx.cleanupBranch);
    branchExists = true;
  } catch {
    branchExists = false;
  }

  if (!ctx.existingPrNumber) {
    return {
      action: branchExists ? "replacement_required" : "create_new_branch_and_pr",
      branchExists,
      reason: branchExists
        ? "A branch from a prior attempt exists but no pull request is on record for it — the original delivery cannot be safely resumed, so a replacement pull request is required."
        : "No prior branch or pull request exists for this task — this is the first delivery attempt.",
    };
  }

  try {
    const existing = await client.getPullRequest(ctx.owner, ctx.repo, ctx.existingPrNumber);
    if (existing.state === "open" && branchExists) {
      return {
        action: "reuse_existing_branch_and_pr",
        branchExists,
        existingPr: existing,
        reason: "The original pull request and branch are both still open — RepoDiet will repair the same pull request instead of opening a new one.",
      };
    }
    return {
      action: "replacement_required",
      branchExists,
      existingPr: existing,
      reason: `The original pull request is "${existing.state}" — it cannot be repaired, so a replacement pull request is required.`,
    };
  } catch {
    // A prior attempt is known to exist (existingPrNumber was passed in from
    // this task's own delivery record) even though it can no longer be
    // located — this is always a replacement, not a fresh first attempt.
    return {
      action: "replacement_required",
      branchExists,
      reason: "The original pull request could not be found (it may have been deleted) — a replacement pull request is required.",
    };
  }
}
