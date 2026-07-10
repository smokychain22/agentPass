import type { A2ATaskRecord, A2ATaskStatus } from "./types";
import { saveA2ATask } from "./task-store";

export async function deliverTaskCallback(task: A2ATaskRecord): Promise<void> {
  const url = task.input.callbackUrl?.trim();
  if (!url) return;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: task.id,
        type: task.type,
        status: task.status,
        repository: task.repository,
        scanId: task.scanId,
        approval: task.approval,
        result: task.result,
        error: task.error,
        completedAt: task.completedAt,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // Best-effort — polling remains authoritative.
  }
}

export async function persistTask(task: A2ATaskRecord): Promise<A2ATaskRecord> {
  await saveA2ATask(task);
  if (task.status === "awaiting_approval" || task.completedAt) {
    await deliverTaskCallback(task);
  }
  return task;
}

export function isFailureStatus(status: A2ATaskStatus): boolean {
  return [
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
