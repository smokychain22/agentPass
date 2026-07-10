import { durableId, durableNow, getDurableRecord, setDurableRecord } from "@/lib/store/durable-store";
import type { A2ATaskRecord, A2ATaskStatus, A2ATaskType, A2ATaskInput } from "./types";

export function createA2ATaskId(): string {
  return durableId("task");
}

export async function saveA2ATask(task: A2ATaskRecord): Promise<A2ATaskRecord> {
  await setDurableRecord("a2a_tasks", task.id, task);
  return task;
}

export async function getA2ATask(taskId: string): Promise<A2ATaskRecord | undefined> {
  return getDurableRecord<A2ATaskRecord>("a2a_tasks", taskId);
}

export async function updateA2ATask(
  taskId: string,
  patch: Partial<A2ATaskRecord>
): Promise<A2ATaskRecord | undefined> {
  const existing = await getA2ATask(taskId);
  if (!existing) return undefined;
  const updated: A2ATaskRecord = {
    ...existing,
    ...patch,
    updatedAt: durableNow(),
  };
  await setDurableRecord("a2a_tasks", taskId, updated);
  return updated;
}

export function buildInitialTask(
  type: A2ATaskType,
  input: A2ATaskInput,
  repository: A2ATaskRecord["repository"]
): A2ATaskRecord {
  const now = durableNow();
  return {
    id: createA2ATaskId(),
    type,
    status: "submitted",
    repository,
    input,
    result: {},
    transitions: [{ status: "submitted", at: now, role: "orchestrator" }],
    limitations: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function isTerminalStatus(status: A2ATaskStatus): boolean {
  return [
    "completed",
    "rejected",
    "unsupported",
    "payment_failed",
    "analysis_failed",
    "verification_failed",
    "delivery_failed",
    "cancelled",
    "expired",
  ].includes(status);
}
