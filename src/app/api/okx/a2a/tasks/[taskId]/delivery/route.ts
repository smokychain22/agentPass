import { NextResponse } from "next/server";
import { getA2ATask } from "@/lib/a2a/task-store";
import { getMarketplaceDelivery } from "@/lib/okx/store";
import { submitA2aDeliveryEvidence } from "@/lib/a2a/settlement-lifecycle";
import { formatA2ATaskResponse } from "@/lib/a2a/orchestrator";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await context.params;
  const task = await getA2ATask(taskId);
  if (!task) {
    return NextResponse.json({ success: false, error: "Task not found." }, { status: 404 });
  }

  const deliveryId = task.result.settlement?.deliveryId ?? `delivery_${taskId}`;
  const delivery = await getMarketplaceDelivery(deliveryId);

  return NextResponse.json({
    success: true,
    taskId,
    status: task.status,
    lifecycleStep: "seller submits delivery evidence / buyer inspects",
    settlement: task.result.settlement ?? null,
    delivery: delivery ?? {
      taskId,
      result: task.result,
      limitations: task.limitations,
    },
  });
}

/** Seller submits (or re-submits idempotently) delivery evidence after Green PR is ready. */
export async function POST(
  _request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await context.params;
  try {
    const task = await submitA2aDeliveryEvidence(taskId);
    return NextResponse.json({
      success: true,
      taskId,
      status: task.status,
      settlement: task.result.settlement,
      task: formatA2ATaskResponse(task),
      note: "Delivery evidence recorded. Buyer must accept before escrow release.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delivery submission failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
