import { NextResponse } from "next/server";
import { cancelA2ATask, formatA2ATaskResponse } from "@/lib/a2a/orchestrator";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await context.params;
    const task = await cancelA2ATask(taskId);
    return NextResponse.json({ success: false, ...formatA2ATaskResponse(task) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cancel failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
