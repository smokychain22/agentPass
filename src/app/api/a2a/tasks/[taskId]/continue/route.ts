import { NextResponse } from "next/server";
import {
  continueA2ATaskExecution,
  formatA2ATaskResponse,
  generateA2AQuoteForTask,
} from "@/lib/a2a/orchestrator";
import { getA2ATask } from "@/lib/a2a/task-store";
import { requiresPayment } from "@/lib/a2a/types";
import { buildSessionKey } from "@/lib/github-app/browser-session";
import { assertDirectTaskOwner } from "@/lib/workflow/task-access";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Resume a durable A2A task after deep-scan completion:
 * - reconcile parent from child if needed
 * - generate bound cleanup quote (safe candidates) when quote is missing
 * - never double-charges; fund is a separate POST /fund step
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await context.params;
  const existing = await getA2ATask(taskId);
  if (!existing) {
    return NextResponse.json({ success: false, error: "Task not found." }, { status: 404 });
  }
  try {
    assertDirectTaskOwner(existing, await buildSessionKey(request));
  } catch {
    return NextResponse.json({ success: false, error: "Task access denied." }, { status: 403 });
  }

  try {
    let task =
      (await continueA2ATaskExecution(taskId)) ??
      (await getA2ATask(taskId)) ??
      existing;

    if (
      requiresPayment(task.type) &&
      (task.status === "quote_required" || !task.input.quoteId) &&
      task.status !== "awaiting_payment"
    ) {
      task = await generateA2AQuoteForTask(taskId);
    } else if (requiresPayment(task.type) && task.status === "quote_required" && !task.input.quoteId) {
      task = await generateA2AQuoteForTask(taskId);
    }

    return NextResponse.json({
      success: true,
      ...formatA2ATaskResponse(task),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Continue failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
