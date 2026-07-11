import { NextResponse } from "next/server";
import { formatA2ATaskResponse } from "@/lib/a2a/orchestrator";
import { getA2ATask } from "@/lib/a2a/task-store";
import { getOkxOrder, getOkxOrderByA2aTask } from "@/lib/okx/store";

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
  const order =
    (await getOkxOrderByA2aTask(taskId)) ?? (await getOkxOrder(taskId));
  return NextResponse.json({
    success: true,
    task: formatA2ATaskResponse(task),
    order: order ?? null,
  });
}
