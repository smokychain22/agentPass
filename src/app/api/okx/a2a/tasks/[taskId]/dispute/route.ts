import { NextResponse } from "next/server";
import { disputeA2aDeliveryByBuyer } from "@/lib/a2a/settlement-lifecycle";
import { formatA2ATaskResponse } from "@/lib/a2a/orchestrator";

export const runtime = "nodejs";

/** Open OKX dispute / arbitration for a delivered cleanup. */
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
    const task = await disputeA2aDeliveryByBuyer(taskId, body);
    return NextResponse.json({
      success: true,
      taskId,
      status: task.status,
      settlement: task.result.settlement,
      task: formatA2ATaskResponse(task),
      nextStep: "Continue dispute resolution in OKX.AI arbitration for A2A service 32947.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Dispute failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
