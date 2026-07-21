import { NextResponse } from "next/server";
import { formatA2ATaskResponse } from "@/lib/a2a/orchestrator";
import { getA2ATask } from "@/lib/a2a/task-store";
import { reconcileParentTaskIfNeeded } from "@/lib/a2a/reconcile-parent-from-scan";
import { buildSessionKey } from "@/lib/github-app/browser-session";
import { assertDirectTaskOwner } from "@/lib/workflow/task-access";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await context.params;
  let task = await getA2ATask(taskId);
  if (!task) {
    return NextResponse.json(
      { ok: false, success: false, error: "Task not found.", terminal: true },
      { status: 404 }
    );
  }
  try {
    assertDirectTaskOwner(task, await buildSessionKey(request));
  } catch {
    return NextResponse.json(
      { ok: false, success: false, error: "Task access denied.", terminal: true },
      { status: 403 }
    );
  }
  // Repair path — never rely on GET as the only advancement mechanism, but heal stranded parents.
  try {
    task = await reconcileParentTaskIfNeeded(task, "status_poll");
  } catch (err) {
    console.error("[a2a-task-status] reconcile failed", taskId, err);
  }
  const formatted = formatA2ATaskResponse(task);
  return NextResponse.json(
    {
      ...formatted,
      // Legacy alias — nonterminal tasks are not API failures.
      success: formatted.ok !== false,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
