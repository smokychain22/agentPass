import { NextResponse } from "next/server";
import { getPlanState, isPlanCurrent } from "@/lib/user-directed/cleanup-plan-store";
import { computeDecisionsFingerprint, listFindingDecisions } from "@/lib/user-directed/decision-store";

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

  const [plan, decisions] = await Promise.all([
    getPlanState(scanId),
    listFindingDecisions(scanId),
  ]);
  const currentDecisionsFingerprint = computeDecisionsFingerprint(decisions);
  const current = isPlanCurrent(plan, pinnedCommit, currentDecisionsFingerprint);
  const superseded = Boolean(
    plan && plan.status === "approved" && pinnedCommit && !current
  );

  return NextResponse.json({
    ok: true,
    plan: plan ?? null,
    currentDecisionsFingerprint,
    approved: Boolean(plan?.status === "approved"),
    current,
    superseded,
  });
}
