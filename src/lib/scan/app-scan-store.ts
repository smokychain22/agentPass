import { nanoid } from "nanoid";
import type { ScanPayload } from "@/lib/scanner/run-scan";
import { setDurableRecord, getDurableRecord } from "@/lib/store/durable-store";

export interface StoredAppScan {
  scanId: string;
  ownerKey?: string;
  payload: ScanPayload;
  repositoryModel?: ScanPayload["repositoryModel"];
  createdAt: string;
}

export function createScanId(): string {
  return `scan_${nanoid(12)}`;
}

export async function storeAppScan(
  scanId: string,
  input: { payload: ScanPayload; ownerKey?: string }
): Promise<StoredAppScan> {
  const record: StoredAppScan = {
    scanId,
    ownerKey: input.ownerKey,
    payload: input.payload,
    repositoryModel: input.payload.repositoryModel,
    createdAt: new Date().toISOString(),
  };
  await setDurableRecord("scans", scanId, record);
  return record;
}

export async function getAppScan(scanId: string): Promise<StoredAppScan | undefined> {
  return getDurableRecord<StoredAppScan>("scans", scanId);
}
