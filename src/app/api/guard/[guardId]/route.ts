import { NextResponse } from "next/server";
import { approveGuardProposal, getGuardStatus } from "@/lib/guard/guard-engine";
import { getGuardRun } from "@/lib/guard/guard-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ guardId: string }> }
) {
  const { guardId } = await context.params;
  const decoded = decodeURIComponent(guardId);

  if (decoded.includes("/")) {
    const status = await getGuardStatus(decoded);
    return NextResponse.json({ success: true, ...status });
  }

  const run = await getGuardRun(decoded);
  if (!run) {
    return NextResponse.json({ success: false, error: "Guard run not found." }, { status: 404 });
  }
  return NextResponse.json({ success: true, run });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ guardId: string }> }
) {
  const { guardId } = await context.params;
  const body = (await request.json()) as { approved?: boolean };
  const approved = body.approved !== false;

  try {
    const run = await approveGuardProposal(guardId, approved);
    return NextResponse.json({ success: true, run });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Approval failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
