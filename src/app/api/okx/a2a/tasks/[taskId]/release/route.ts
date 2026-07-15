import { NextResponse } from "next/server";
import { recordA2aEscrowRelease } from "@/lib/a2a/settlement-lifecycle";
import { formatA2ATaskResponse } from "@/lib/a2a/orchestrator";

export const runtime = "nodejs";

/**
 * Record OKX-native escrow release to the seller after buyer acceptance.
 * RepoDiet does not move marketplace escrow funds; it binds the release reference
 * into durable task evidence and closes the internal payment entitlement.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    escrowReleaseReference?: string;
    sellerWallet?: string;
  };

  if (!body.escrowReleaseReference?.trim()) {
    return NextResponse.json(
      { success: false, error: "escrowReleaseReference is required." },
      { status: 400 }
    );
  }

  try {
    const task = await recordA2aEscrowRelease(taskId, {
      escrowReleaseReference: body.escrowReleaseReference,
      sellerWallet: body.sellerWallet,
    });
    return NextResponse.json({
      success: true,
      taskId,
      status: task.status,
      settlement: task.result.settlement,
      task: formatA2ATaskResponse(task),
      note: "Escrow release recorded. Receipt and task evidence remain available for verification.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Escrow release recording failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
