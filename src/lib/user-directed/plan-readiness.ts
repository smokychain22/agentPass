import { getPlanState, isPlanCurrent, type CleanupPlanRecord } from "./cleanup-plan-store";
import { computeDecisionsFingerprint, listFindingDecisions } from "./decision-store";
import { getStoredFindings } from "@/lib/findings/findings-store";

export type PinnedCommitSource = "request" | "stored_scan" | "approved_plan" | "unavailable";

export interface PlanReadiness {
  plan: CleanupPlanRecord | undefined;
  planFound: boolean;
  planScanId: string | null;
  approved: boolean;
  /** True only when the plan is approved AND still reflects the live decision set and commit. */
  current: boolean;
  superseded: boolean;
  pinnedCommit: string;
  commitSource: PinnedCommitSource;
  decisionFingerprint: string;
  planFingerprint: string | null;
  approvedFindingIds: string[];
  approvedCount: number;
  /** Precise reason the plan is not current — never a misleading count comparison. */
  blockerReason: string | null;
}

/**
 * THE authoritative "is the approved cleanup plan usable right now" selector.
 *
 * Every consumer must use this — Review Findings completion, navigation, the
 * direct patch-route guard, the Continue button, the task-review screen, and
 * the A2A preflight — so no two of them can disagree about what "approved and
 * current" means. Previously the plan-status route and the preflight endpoint
 * each implemented their own version and diverged, which is how preflight
 * reported a plan "superseded: approved for 1 fix(es), but 1 are selected".
 *
 * Pinned-commit resolution runs three tiers, most to least independent:
 *   1. the caller's commit — the only source that can reveal the client having
 *      moved to a different commit than the plan was approved for;
 *   2. the stored scan's commit — server truth for this scan;
 *   3. the plan's own commit — only when neither of the above exists.
 *
 * Tier 3 makes the commit comparison trivially pass, which is correct: the
 * check exists to detect divergence, and with no independent commit there is
 * no evidence of divergence. Protection against changed selections is
 * unaffected — that is carried by the decision fingerprint, always compared.
 */
export async function resolvePlanReadiness(input: {
  scanId: string;
  requestedPinnedCommit?: string;
}): Promise<PlanReadiness> {
  const [plan, decisions, findingsPayload] = await Promise.all([
    getPlanState(input.scanId),
    listFindingDecisions(input.scanId),
    getStoredFindings(input.scanId),
  ]);

  const requested = input.requestedPinnedCommit?.trim() || "";
  const pinnedCommit =
    requested || findingsPayload?.repo.commitSha || plan?.pinnedCommit || "";
  const commitSource: PinnedCommitSource = requested
    ? "request"
    : findingsPayload?.repo.commitSha
      ? "stored_scan"
      : plan?.pinnedCommit
        ? "approved_plan"
        : "unavailable";

  const decisionFingerprint = computeDecisionsFingerprint(decisions);
  const approved = plan?.status === "approved";
  const current = isPlanCurrent(plan, pinnedCommit, decisionFingerprint);
  const superseded = Boolean(approved && pinnedCommit && !current);

  let blockerReason: string | null = null;
  if (!plan) {
    blockerReason = "No cleanup plan exists for this scan.";
  } else if (!approved) {
    blockerReason = `The cleanup plan has not been approved (status: ${plan.status}).`;
  } else if (!current) {
    // Name the actual divergence rather than comparing counts, which can be
    // equal even when the plan is genuinely stale.
    if (plan.decisionsFingerprint !== decisionFingerprint) {
      blockerReason =
        "Your selected fixes changed after this cleanup plan was approved. Review and approve the updated plan.";
    } else if (pinnedCommit && plan.pinnedCommit !== pinnedCommit) {
      blockerReason = `The cleanup plan was approved for commit ${plan.pinnedCommit.slice(0, 12)}…, but the active commit is ${pinnedCommit.slice(0, 12)}…. Re-scan and approve again.`;
    } else {
      blockerReason = "The approved cleanup plan could not be confirmed against a pinned commit.";
    }
  }

  return {
    plan,
    planFound: Boolean(plan),
    planScanId: plan?.scanId ?? null,
    approved,
    current,
    superseded,
    pinnedCommit,
    commitSource,
    decisionFingerprint,
    planFingerprint: plan?.decisionsFingerprint ?? null,
    approvedFindingIds: plan?.includedFindingIds ?? [],
    approvedCount: plan?.includedFindingIds.length ?? 0,
    blockerReason,
  };
}
