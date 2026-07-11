import { NextResponse } from "next/server";
import { formatA2ATaskResponse } from "@/lib/a2a/orchestrator";
import { getA2ATask } from "@/lib/a2a/task-store";

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
  return NextResponse.json({
    success: task.status === "completed",
    ...formatA2ATaskResponse(task),
  });
}
