import { NextResponse } from "next/server";
import { approveA2ATask, formatA2ATaskResponse } from "@/lib/a2a/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await context.params;
    const body = (await request.json()) as { approved?: boolean };
    const task = await approveA2ATask(taskId, body.approved !== false);
    return NextResponse.json({
      success: task.status === "completed",
      ...formatA2ATaskResponse(task),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Approval failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
