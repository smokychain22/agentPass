import { randomUUID } from "node:crypto";
import type { ScanRecord } from "./types";

const globalStore = globalThis as unknown as {
  __repodietScans?: Map<string, ScanRecord>;
};

function store(): Map<string, ScanRecord> {
  if (!globalStore.__repodietScans) {
    globalStore.__repodietScans = new Map();
  }
  return globalStore.__repodietScans;
}

export function createScanRecord(url: string, branch?: string): ScanRecord {
  const now = new Date().toISOString();
  const record: ScanRecord = {
    id: randomUUID(),
    status: "pending",
    url,
    branch,
    createdAt: now,
    updatedAt: now,
  };
  store().set(record.id, record);
  return record;
}

export function getScan(id: string): ScanRecord | undefined {
  return store().get(id);
}

export function updateScan(
  id: string,
  patch: Partial<Pick<ScanRecord, "status" | "result" | "error">>
): ScanRecord | undefined {
  const existing = store().get(id);
  if (!existing) return undefined;
  const updated: ScanRecord = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  store().set(id, updated);
  return updated;
}
