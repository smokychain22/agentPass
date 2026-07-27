import { NextResponse } from "next/server";
import { getPlanState, isPlanCurrent } from "@/lib/user-directed/cleanup-plan-store";
import { computeDecisionsFingerprint, listFindingDecisions } from "@/lib/user-directed/decision-store";
import { getStoredFindings } from "@/lib/findings/findings-store";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Single authoritative source for "is the approved cleanup plan still valid".
 * Computed entirely from persisted state (the plan record + the live
 * decision set) so the client can never disagree with the backend by
 * drifting local state — if any decision changed since approval, this
 * reports superseded=true regardless of what the UI still shows.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const scanId = url.searchParams.get("scanId");
  const pinnedCommit = url.searchParams.get("pinnedCommit") ?? "";

  if (!scanId) {
    return NextResponse.json({ ok: false, error: "scanId is required." }, { status: 400 });
  }

  const [plan, decisions, findingsPayload] = await Promise.all([
    getPlanState(scanId),
    listFindingDecisions(scanId),
    getStoredFindings(scanId),
  ]);

  // The pinned commit is server truth. A client that has not finished
  // hydrating its session cannot supply it, and previously that produced an
  // empty string — which made isPlanCurrent() fail and reported a perfectly
  // valid approved plan as not-current. Resolve it from the stored scan
  // whenever the caller does not pass one, rather than comparing against "".
  const resolvedCommit = pinnedCommit || findingsPayload?.repo.commitSha || "";

  const currentDecisionsFingerprint = computeDecisionsFingerprint(decisions);
  const current = isPlanCurrent(plan, resolvedCommit, currentDecisionsFingerprint);
  const superseded = Boolean(
    plan && plan.status === "approved" && resolvedCommit && !current
  );

  return NextResponse.json({
    ok: true,
    plan: plan ?? null,
    currentDecisionsFingerprint,
    approved: Boolean(plan?.status === "approved"),
    current,
    superseded,
    // Authoritative echo so callers can prove which scan/commit was judged.
    scanId,
    pinnedCommit: resolvedCommit,
    commitSource: pinnedCommit ? "request" : "stored_scan",
    planScanId: plan?.scanId ?? null,
    selectedCount: plan?.includedFindingIds.length ?? 0,
  });
}
