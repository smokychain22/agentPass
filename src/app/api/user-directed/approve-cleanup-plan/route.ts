import { NextResponse } from "next/server";
import { approvePlan } from "@/lib/user-directed/cleanup-plan-store";

export const runtime = "nodejs";
export const maxDuration = 30;

/** User has reviewed the plan and approved it. Idempotent — approving twice for the same selection is a no-op. */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    scanId?: string;
    pinnedCommit?: string;
    includeFindingIds?: string[];
  };

  if (!body.scanId || !body.pinnedCommit) {
    return NextResponse.json(
      { ok: false, error: "scanId and pinnedCommit are required." },
      { status: 400 }
    );
  }

  try {
    const plan = await approvePlan({
      scanId: body.scanId,
      pinnedCommit: body.pinnedCommit,
      includedFindingIds: body.includeFindingIds ?? [],
    });
    return NextResponse.json({ ok: true, plan });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not approve cleanup plan.";
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
}
