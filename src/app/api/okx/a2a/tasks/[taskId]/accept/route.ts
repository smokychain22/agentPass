import { NextResponse } from "next/server";
import { acceptA2aDeliveryByBuyer } from "@/lib/a2a/settlement-lifecycle";
import { formatA2ATaskResponse } from "@/lib/a2a/orchestrator";

export const runtime = "nodejs";

/**
 * Buyer inspects the delivered Green PR and accepts.
 * Escrow release is a separate step (POST .../release) with the OKX release reference.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    buyerWallet?: string;
    okxAcceptanceReference?: string;
  };

  try {
    const task = await acceptA2aDeliveryByBuyer(taskId, body);
    return NextResponse.json({
      success: true,
      taskId,
      status: task.status,
      settlement: task.result.settlement,
      task: formatA2ATaskResponse(task),
      nextStep: "Record OKX escrow release via POST /api/okx/a2a/tasks/{taskId}/release",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Buyer acceptance failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
