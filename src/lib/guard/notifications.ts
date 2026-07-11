import { nanoid } from "nanoid";
import type { GuardDelta, GuardNotification, GuardProposal } from "./types";
import { deltaPresentation } from "./delta-analysis";

export function buildGuardProposal(delta: GuardDelta, monthlyAllowanceRemaining: number): GuardProposal {
  if (delta.newSafeCandidates.length === 0) {
    return {
      type: "none",
      findingIds: [],
      reason: "No new policy-approved safe candidates detected.",
      requiresApproval: false,
      monthlyAllowanceUsed: false,
    };
  }

  const findingIds = delta.newSafeCandidates.slice(0, 5).map((f) => f.id);
  const canUsePrAllowance = monthlyAllowanceRemaining > 0;

  return {
    type: canUsePrAllowance ? "cleanup_pr" : "safe_cleanup",
    findingIds,
    reason: canUsePrAllowance
      ? `${findingIds.length} new safe candidate(s) eligible for monthly cleanup PR allowance.`
      : `${findingIds.length} new safe candidate(s) — propose in-app cleanup (monthly PR allowance used).`,
    requiresApproval: true,
    monthlyAllowanceUsed: canUsePrAllowance,
  };
}

export function buildGuardNotification(input: {
  delta: GuardDelta;
  proposal: GuardProposal;
  repository: string;
  trigger: string;
  suppressedIgnoredCount: number;
}): GuardNotification | null {
  const presentation = deltaPresentation(input.delta);
  const isMergeEvent = input.trigger === "pull_request_merged";
  const hasDebtChange =
    input.delta.newFindings.length > 0 || input.delta.resolvedFindings.length > 0;
  const hasMeaningful =
    hasDebtChange || input.proposal.type !== "none" || isMergeEvent;

  if (!hasMeaningful) {
    return null;
  }

  const title =
    input.delta.debtTrend.direction === "up" && input.delta.newFindings.length > 0
      ? `New cleanup debt detected in ${input.repository}`
      : input.delta.resolvedFindings.length > 0
        ? `Cleanup progress in ${input.repository}`
        : isMergeEvent
          ? `Post-merge scan complete for ${input.repository}`
          : `Repo Guard scan complete for ${input.repository}`;

  const summary = [
    hasDebtChange
      ? `${input.delta.newFindings.length} new finding(s)`
      : "No new cleanup debt",
    `${input.delta.resolvedFindings.length} resolved`,
    `${input.suppressedIgnoredCount} ignored (suppressed)`,
    input.proposal.type !== "none" ? `Proposal: ${input.proposal.reason}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    id: `guard_notif_${nanoid(8)}`,
    title,
    summary,
    meaningful: true,
    deliveredAt: new Date().toISOString(),
    channel: "api",
    suppressedIgnoredCount: input.suppressedIgnoredCount,
    payload: { trigger: input.trigger, presentation, proposal: input.proposal },
  };
}

export async function deliverGuardNotification(
  callbackUrl: string | undefined,
  notification: GuardNotification
): Promise<{ delivered: boolean; error?: string }> {
  if (!callbackUrl) {
    return { delivered: false, error: "No callback URL configured." };
  }
  try {
    const res = await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "repodiet.guard.notification",
        notification,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    return { delivered: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    return {
      delivered: false,
      error: err instanceof Error ? err.message : "Callback delivery failed.",
    };
  }
}
