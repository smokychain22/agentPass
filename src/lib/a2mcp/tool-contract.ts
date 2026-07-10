import { A2MCP_VERSION } from "./constants";
import type { AgentTaskRecord, AgentTaskStatus } from "./task-store";

export interface ToolActionResponse {
  success: boolean;
  taskId: string;
  tool: string;
  version: string;
  repository: AgentTaskRecord["repository"];
  status: AgentTaskStatus;
  result: Record<string, unknown>;
  analyzers: AgentTaskRecord["analyzers"];
  limitations: string[];
  receipt: AgentTaskRecord["receipt"];
  error?: { code: string; message: string };
}

export function buildToolActionResponse(
  tool: string,
  task: AgentTaskRecord
): ToolActionResponse {
  return {
    success: task.status !== "failed",
    taskId: task.id,
    tool,
    version: A2MCP_VERSION,
    repository: task.repository,
    status: task.status,
    result: task.result,
    analyzers: task.analyzers,
    limitations: task.limitations,
    receipt: task.receipt,
    ...(task.error ? { error: { code: "TASK_FAILED", message: task.error } } : {}),
  };
}

export function buildToolErrorResponse(
  tool: string,
  taskId: string,
  code: string,
  message: string,
  status: AgentTaskStatus = "failed"
): ToolActionResponse {
  return {
    success: false,
    taskId,
    tool,
    version: A2MCP_VERSION,
    repository: { owner: "", name: "", branch: "main" },
    status,
    result: {},
    analyzers: {},
    limitations: [],
    receipt: {},
    error: { code, message },
  };
}
