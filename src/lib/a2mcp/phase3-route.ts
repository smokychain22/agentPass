import { NextResponse } from "next/server";
import { A2MCP_VERSION, TOOL_TIMEOUT_MS } from "./constants";
import { ToolExecutionError, mapErrorToToolError } from "./errors";
import { withTimeout } from "./responses";
import { buildToolActionResponse, buildToolErrorResponse } from "./tool-contract";
import type { AgentTaskRecord } from "./task-store";
import { createTaskId } from "./task-store";

export async function runPhase3ToolRoute(
  tool: string,
  request: Request,
  handler: (body: unknown, taskId: string) => Promise<AgentTaskRecord>,
  timeoutMs: number = TOOL_TIMEOUT_MS
): Promise<NextResponse> {
  const taskId = createTaskId();
  try {
    if (request.method !== "POST") {
      return NextResponse.json(
        buildToolErrorResponse(tool, taskId, "INVALID_INPUT", "Only POST is supported."),
        { status: 405 }
      );
    }

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      throw new ToolExecutionError("INVALID_INPUT", "Request body must be valid JSON.", 400);
    }

    const task = await withTimeout(handler(body, taskId), timeoutMs, tool);
    const response = buildToolActionResponse(tool, task);
    return NextResponse.json(response, {
      status: task.status === "failed" ? 422 : 200,
    });
  } catch (err) {
    const mapped = mapErrorToToolError(err, tool);
    return NextResponse.json(
      buildToolErrorResponse(tool, taskId, mapped.code, mapped.message),
      { status: mapped.status }
    );
  }
}

export function phase3GetResponse(tool: string, task: AgentTaskRecord): NextResponse {
  const response = buildToolActionResponse(tool, task);
  return NextResponse.json(response, {
    status: task.status === "failed" ? 404 : 200,
  });
}

export function phase3Meta() {
  return { tool: "get_task_status", version: A2MCP_VERSION };
}
