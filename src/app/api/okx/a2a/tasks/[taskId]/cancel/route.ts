import { NextResponse } from "next/server";
import { cancelA2ATask } from "@/lib/a2a/orchestrator";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await context.params;
  try {
    const task = await cancelA2ATask(taskId);
    return NextResponse.json({ success: true, task });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cancel failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
