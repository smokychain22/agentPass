import { NextResponse } from "next/server";
import {
  formatA2ATaskResponse,
  rejectUnsafeSelectionA2ATask,
} from "@/lib/a2a/orchestrator";
import { getA2ATask } from "@/lib/a2a/task-store";
import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

function authorized(request: Request): boolean {
  const secret = process.env.REPODIET_INTERNAL_TASK_SECRET?.trim();
  if (!secret) return false;
  const provided =
    request.headers.get("x-repodiet-internal-secret")?.trim() ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    "";
  if (!provided || provided.length !== secret.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  } catch {
    return false;
  }
}

/**
 * Operator/internal terminal rejection for unsafe selections (no payment / no write).
 * Requires REPODIET_INTERNAL_TASK_SECRET.
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { taskId?: string; reason?: string };
    const taskId = body.taskId?.trim();
    if (!taskId) {
      return NextResponse.json({ success: false, error: "taskId is required." }, { status: 400 });
    }
    const existing = await getA2ATask(taskId);
    if (!existing) {
      return NextResponse.json({ success: false, error: "Task not found." }, { status: 404 });
    }

    const reason =
      body.reason?.trim() ||
      "REJECTED_UNSAFE_SELECTION: src/config/runtime-hook.ts is a runtime/config hook";

    const task = await rejectUnsafeSelectionA2ATask(taskId, reason);
    return NextResponse.json({
      success: true,
      charged: false,
      repositoryWritePerformed: false,
      workflowDispatched: false,
      ...formatA2ATaskResponse(task),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reject failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
