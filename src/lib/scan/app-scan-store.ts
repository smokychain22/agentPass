import { nanoid } from "nanoid";
import type { ScanPayload } from "@/lib/scanner/run-scan";
import { setDurableRecord, getDurableRecord } from "@/lib/store/durable-store";
import type { WorkflowInvalidationMeta } from "@/lib/workflow/source-invalidation";

export interface StoredAppScan {
  scanId: string;
  ownerKey?: string;
  payload: ScanPayload;
  repositoryModel?: ScanPayload["repositoryModel"];
  workflowMeta?: WorkflowInvalidationMeta;
  createdAt: string;
}

export function createScanId(): string {
  return `scan_${nanoid(12)}`;
}

export async function storeAppScan(
  scanId: string,
  input: { payload: ScanPayload; ownerKey?: string; workflowMeta?: WorkflowInvalidationMeta }
): Promise<StoredAppScan> {
  const existing = await getAppScan(scanId);
  const record: StoredAppScan = {
    scanId,
    ownerKey: input.ownerKey,
    payload: input.payload,
    repositoryModel: input.payload.repositoryModel,
    workflowMeta: input.workflowMeta ?? existing?.workflowMeta,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  await setDurableRecord("scans", scanId, record);
  return record;
}

export async function getAppScan(scanId: string): Promise<StoredAppScan | undefined> {
  return getDurableRecord<StoredAppScan>("scans", scanId);
}
