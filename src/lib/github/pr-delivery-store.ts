import { getDurableRecord, setDurableRecord } from "@/lib/store/durable-store";
import type { PrDeliveryMonitorRecord } from "@/lib/github/pr-check-types";

function monitorKey(owner: string, repo: string, prNumber: number): string {
  return `${owner}/${repo}#${prNumber}`.toLowerCase();
}

function taskMonitorKey(taskId: string): string {
  return `task:${taskId}`;
}

export async function savePrDeliveryMonitor(
  record: PrDeliveryMonitorRecord
): Promise<void> {
  await setDurableRecord(
    "pr_delivery_monitors",
    monitorKey(record.owner, record.repo, record.prNumber),
    record
  );
  if (record.taskId) {
    await setDurableRecord(
      "pr_delivery_monitors",
      taskMonitorKey(record.taskId),
      { owner: record.owner, repo: record.repo, prNumber: record.prNumber }
    );
  }
}

export async function getPrDeliveryMonitor(
  owner: string,
  repo: string,
  prNumber: number
): Promise<PrDeliveryMonitorRecord | undefined> {
  return getDurableRecord<PrDeliveryMonitorRecord>(
    "pr_delivery_monitors",
    monitorKey(owner, repo, prNumber)
  );
}

export async function getPrDeliveryMonitorByTaskId(
  taskId: string
): Promise<PrDeliveryMonitorRecord | undefined> {
  const ref = await getDurableRecord<{
    owner: string;
    repo: string;
    prNumber: number;
  }>("pr_delivery_monitors", taskMonitorKey(taskId));
  if (!ref) return undefined;
  return getPrDeliveryMonitor(ref.owner, ref.repo, ref.prNumber);
}
