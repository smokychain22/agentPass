import { NextResponse } from "next/server";
import { getA2ATask } from "@/lib/a2a/task-store";
import { getMarketplaceDelivery } from "@/lib/okx/store";

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

  const deliveryId = `delivery_${taskId}`;
  const delivery = await getMarketplaceDelivery(deliveryId);

  return NextResponse.json({
    success: true,
    taskId,
    status: task.status,
    delivery: delivery ?? {
      taskId,
      result: task.result,
      limitations: task.limitations,
    },
  });
}
