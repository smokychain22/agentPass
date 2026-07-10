import {
  deleteDurableRecord,
  durableNow,
  getDurableRecord,
  setDurableRecord,
} from "@/lib/store/durable-store";
import type { TaskQuote } from "@/lib/execution/task-quote";
import type { ExecutionReceipt } from "@/lib/operator/sign-receipt";
import type { FreeCleanupResult } from "@/lib/execution/run-cleanup-core";

export interface RepositoryRecord {
  id: string;
  owner: string;
  name: string;
  defaultBranch: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface RepositorySnapshotRecord {
  id: string;
  repositoryId: string;
  branch: string;
  commitSha: string;
  capturedAt: string;
}

export interface ScanRecord {
  id: string;
  repositoryId: string;
  branch: string;
  commitSha?: string;
  status: "complete" | "failed";
  createdAt: string;
}

export interface CleanupRunRecord {
  id: string;
  scanId?: string;
  repository: string;
  branch: string;
  commitSha: string;
  mode: FreeCleanupResult["mode"];
  findingIds: string[];
  status: FreeCleanupResult["patchStatus"];
  metrics: FreeCleanupResult["metrics"];
  fixLoop: FreeCleanupResult["fixLoop"];
  createdAt: string;
}

export interface TaskQuoteRecord extends TaskQuote {
  createdAt: string;
  status: "active" | "consumed" | "expired";
}

export interface ExecutionReceiptRecord {
  id: string;
  receipt: ExecutionReceipt;
  signature: string | null;
  signedBy: string | null;
  createdAt: string;
}

function repoKey(owner: string, name: string): string {
  return `${owner}/${name}`;
}

export async function upsertRepository(input: {
  owner: string;
  name: string;
  branch: string;
  url: string;
}): Promise<RepositoryRecord> {
  const id = repoKey(input.owner, input.name);
  const existing = await getDurableRecord<RepositoryRecord>("repositories", id);
  const now = durableNow();
  const record: RepositoryRecord = {
    id,
    owner: input.owner,
    name: input.name,
    defaultBranch: input.branch,
    url: input.url,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await setDurableRecord("repositories", id, record);
  return record;
}

export async function saveRepositorySnapshot(input: {
  repositoryId: string;
  branch: string;
  commitSha: string;
}): Promise<RepositorySnapshotRecord> {
  const id = `snap_${input.repositoryId}_${input.commitSha.slice(0, 12)}`;
  const record: RepositorySnapshotRecord = {
    id,
    repositoryId: input.repositoryId,
    branch: input.branch,
    commitSha: input.commitSha,
    capturedAt: durableNow(),
  };
  await setDurableRecord("repository_snapshots", id, record);
  return record;
}

export async function saveScanRecord(input: {
  id: string;
  repositoryId: string;
  branch: string;
  commitSha?: string;
  status: ScanRecord["status"];
}): Promise<ScanRecord> {
  const record: ScanRecord = {
    id: input.id,
    repositoryId: input.repositoryId,
    branch: input.branch,
    commitSha: input.commitSha,
    status: input.status,
    createdAt: durableNow(),
  };
  await setDurableRecord("scans", input.id, record);
  return record;
}

export async function saveCleanupRun(
  result: FreeCleanupResult,
  context: { repository: string; branch: string; commitSha: string; scanId?: string }
): Promise<CleanupRunRecord> {
  const record: CleanupRunRecord = {
    id: result.id,
    scanId: context.scanId,
    repository: context.repository,
    branch: context.branch,
    commitSha: context.commitSha,
    mode: result.mode,
    findingIds: result.selectedFindings.map((f) => f.id),
    status: result.patchStatus,
    metrics: result.metrics,
    fixLoop: result.fixLoop,
    createdAt: durableNow(),
  };
  await setDurableRecord("cleanup_runs", result.id, record);
  return record;
}

export async function saveTaskQuote(quote: TaskQuote): Promise<TaskQuoteRecord> {
  const record: TaskQuoteRecord = {
    ...quote,
    createdAt: durableNow(),
    status: "active",
  };
  await setDurableRecord("task_quotes", quote.quoteId, record);
  return record;
}

export async function getTaskQuote(quoteId: string): Promise<TaskQuoteRecord | undefined> {
  return getDurableRecord<TaskQuoteRecord>("task_quotes", quoteId);
}

export async function saveExecutionReceiptRecord(input: {
  receipt: ExecutionReceipt;
  signature: string | null;
  signedBy: string | null;
}): Promise<ExecutionReceiptRecord> {
  const record: ExecutionReceiptRecord = {
    id: input.receipt.taskId,
    receipt: input.receipt,
    signature: input.signature,
    signedBy: input.signedBy,
    createdAt: durableNow(),
  };
  await setDurableRecord("execution_receipts", input.receipt.taskId, record);
  return record;
}

export async function getExecutionReceipt(
  taskId: string
): Promise<ExecutionReceiptRecord | undefined> {
  return getDurableRecord<ExecutionReceiptRecord>("execution_receipts", taskId);
}

export async function deleteExecutionReceipt(taskId: string): Promise<void> {
  await deleteDurableRecord("execution_receipts", taskId);
}
