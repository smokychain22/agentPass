import { NextResponse } from "next/server";
import { fundA2ATask, formatA2ATaskResponse } from "@/lib/a2a/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await context.params;
    const body = (await request.json()) as { quoteId?: string; paymentReference?: string };
    const task = await fundA2ATask(taskId, body);
    return NextResponse.json({
      success: task.status === "completed" || task.status === "awaiting_approval",
      ...formatA2ATaskResponse(task),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Funding failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
