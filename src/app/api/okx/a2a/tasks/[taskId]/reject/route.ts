import { NextResponse } from "next/server";
import { rejectA2aDeliveryByBuyer } from "@/lib/a2a/settlement-lifecycle";
import { formatA2ATaskResponse } from "@/lib/a2a/orchestrator";

export const runtime = "nodejs";

/** Buyer rejects the delivered Green PR. Escrow remains under OKX lifecycle rules. */
export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    buyerWallet?: string;
    reason?: string;
  };

  try {
    const task = await rejectA2aDeliveryByBuyer(taskId, body);
    return NextResponse.json({
      success: true,
      taskId,
      status: task.status,
      settlement: task.result.settlement,
      task: formatA2ATaskResponse(task),
      nextStep: "Follow OKX A2A rejection / refund rules for escrow; RepoDiet will not reverse escrow itself.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Buyer rejection failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
