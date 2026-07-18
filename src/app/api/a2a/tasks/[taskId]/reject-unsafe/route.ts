import { NextResponse } from "next/server";
import {
  formatA2ATaskResponse,
  rejectUnsafeSelectionA2ATask,
} from "@/lib/a2a/orchestrator";
import { getA2ATask } from "@/lib/a2a/task-store";
import { buildSessionKey } from "@/lib/github-app/browser-session";
import { assertDirectTaskOwner } from "@/lib/workflow/task-access";

export const runtime = "nodejs";

/**
 * Terminal rejection for hard-rejected cleanup selections (e.g. runtime/config hooks).
 * Does not charge, dispatch, or mutate repositories.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await context.params;
    const existing = await getA2ATask(taskId);
    if (!existing) {
      return NextResponse.json({ success: false, error: "Task not found." }, { status: 404 });
    }
    assertDirectTaskOwner(existing, await buildSessionKey(request));

    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const reason =
      body.reason?.trim() ||
      "Selected path is not eligible for controlled delivery (unsafe selection).";

    const task = await rejectUnsafeSelectionA2ATask(taskId, reason);
    return NextResponse.json({
      success: true,
      charged: false,
      repositoryWritePerformed: false,
      ...formatA2ATaskResponse(task),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reject failed.";
    return NextResponse.json(
      {
        success: false,
        error: message === "task_access_denied" ? "Task access denied." : message,
      },
      { status: message === "task_access_denied" ? 403 : 422 }
    );
  }
}
