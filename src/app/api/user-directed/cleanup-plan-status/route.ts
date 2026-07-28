import { NextResponse } from "next/server";
import { resolvePlanReadiness } from "@/lib/user-directed/plan-readiness";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Single authoritative source for "is the approved cleanup plan still valid".
 * Delegates entirely to resolvePlanReadiness() so this route, the A2A
 * preflight, and every UI consumer share one definition of "approved and
 * current" and can never drift apart.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const scanId = url.searchParams.get("scanId");
  const pinnedCommit = url.searchParams.get("pinnedCommit") ?? "";

  if (!scanId) {
    return NextResponse.json({ ok: false, error: "scanId is required." }, { status: 400 });
  }

  const readiness = await resolvePlanReadiness({
    scanId,
    requestedPinnedCommit: pinnedCommit,
  });

  return NextResponse.json({
    ok: true,
    plan: readiness.plan ?? null,
    currentDecisionsFingerprint: readiness.decisionFingerprint,
    approved: readiness.approved,
    current: readiness.current,
    superseded: readiness.superseded,
    // Authoritative echo so callers can prove which scan/commit was judged.
    scanId,
    pinnedCommit: readiness.pinnedCommit,
    commitSource: readiness.commitSource,
    planScanId: readiness.planScanId,
    selectedCount: readiness.approvedCount,
    blockerReason: readiness.blockerReason,
  });
}
