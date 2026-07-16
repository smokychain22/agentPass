import { NextResponse } from "next/server";
import { approveA2ATask, formatA2ATaskResponse } from "@/lib/a2a/orchestrator";
import { getA2ATask } from "@/lib/a2a/task-store";
import { buildSessionKey } from "@/lib/github-app/browser-session";
import { assertDirectTaskOwner } from "@/lib/workflow/task-access";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await context.params;
    const existing = await getA2ATask(taskId);
    if (!existing) return NextResponse.json({ success: false, error: "Task not found." }, { status: 404 });
    assertDirectTaskOwner(existing, await buildSessionKey(request));
    const body = (await request.json()) as { approved?: boolean };
    const task = await approveA2ATask(taskId, body.approved !== false);
    return NextResponse.json({
      success: task.status === "completed",
      ...formatA2ATaskResponse(task),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Approval failed.";
    return NextResponse.json(
      { success: false, error: message === "task_access_denied" ? "Task access denied." : message },
      { status: message === "task_access_denied" ? 403 : 422 }
    );
  }
}
