import { NextResponse } from "next/server";
import { approveA2ATask } from "@/lib/a2a/orchestrator";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as { approved?: boolean };
    const task = await approveA2ATask(taskId, body.approved !== false);
    return NextResponse.json({ success: true, task });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Approval failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
