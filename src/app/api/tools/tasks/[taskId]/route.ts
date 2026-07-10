import { NextResponse } from "next/server";
import { phase3GetResponse } from "@/lib/a2mcp/phase3-route";
import { executeGetTaskStatus } from "@/lib/a2mcp/phase3-engine";
import { buildToolErrorResponse } from "@/lib/a2mcp/tool-contract";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await context.params;
  const task = await executeGetTaskStatus(taskId);
  if (!task) {
    return NextResponse.json(
      buildToolErrorResponse("get_task_status", taskId, "TASK_NOT_FOUND", "Task not found."),
      { status: 404 }
    );
  }
  return phase3GetResponse("get_task_status", task);
}
