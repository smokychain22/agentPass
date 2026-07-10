import { durableId, durableNow, getDurableRecord, setDurableRecord } from "@/lib/store/durable-store";
import type { FindingsPayload, ToolRunReport } from "@/lib/findings/types";
import type { ExecutionReceipt } from "@/lib/operator/sign-receipt";

export type AgentTaskType =
  | "scan_repository"
  | "analyze_repository"
  | "get_findings"
  | "list_safe_fixes"
  | "get_repository_health"
  | "run_free_safe_fix"
  | "run_quick_cleanup"
  | "verify_cleanup"
  | "create_cleanup_pr"
  | "configure_repository_policy"
  | "activate_repo_guard"
  | "verify_patch"
  | "repository_health_delta";

export type AgentTaskStatus = "queued" | "running" | "completed" | "failed";

export interface AgentTaskRepository {
  owner: string;
  name: string;
  branch: string;
  commitSha?: string;
}

export interface AgentTaskRecord {
  id: string;
  type: AgentTaskType;
  status: AgentTaskStatus;
  repository: AgentTaskRepository;
  scanId?: string;
  result: Record<string, unknown>;
  analyzers: Record<string, Pick<ToolRunReport, "status" | "sourceMode" | "error">>;
  limitations: string[];
  receipt: ExecutionReceipt | Record<string, unknown>;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export function createTaskId(): string {
  return durableId("task");
}

export function analyzersFromFindings(
  findings: FindingsPayload
): AgentTaskRecord["analyzers"] {
  const { knip, jscpd, madge } = findings.rawToolReports;
  return {
    knip: { status: knip.status, sourceMode: knip.sourceMode, error: knip.error },
    jscpd: { status: jscpd.status, sourceMode: jscpd.sourceMode, error: jscpd.error },
    madge: { status: madge.status, sourceMode: madge.sourceMode, error: madge.error },
  };
}

export function repositoryFromFindings(findings: FindingsPayload): AgentTaskRepository {
  return {
    owner: findings.repo.owner,
    name: findings.repo.name,
    branch: findings.repo.branch,
    commitSha: findings.repo.commitSha,
  };
}

export async function saveAgentTask(
  input: Omit<AgentTaskRecord, "createdAt" | "updatedAt"> & {
    createdAt?: string;
    updatedAt?: string;
  }
): Promise<AgentTaskRecord> {
  const now = durableNow();
  const record: AgentTaskRecord = {
    ...input,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
  await setDurableRecord("tasks", record.id, record);
  return record;
}

export async function getAgentTask(taskId: string): Promise<AgentTaskRecord | undefined> {
  return getDurableRecord<AgentTaskRecord>("tasks", taskId);
}

export async function updateAgentTask(
  taskId: string,
  patch: Partial<AgentTaskRecord>
): Promise<AgentTaskRecord | undefined> {
  const existing = await getAgentTask(taskId);
  if (!existing) return undefined;
  const updated: AgentTaskRecord = {
    ...existing,
    ...patch,
    updatedAt: durableNow(),
  };
  await setDurableRecord("tasks", taskId, updated);
  return updated;
}
