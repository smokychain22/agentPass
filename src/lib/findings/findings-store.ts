import type { FindingsPayload } from "./types";
import {
  getDurableRecord,
  setDurableRecord,
  deleteDurableRecord,
} from "@/lib/store/durable-store";

const globalCache = globalThis as unknown as {
  __repodietFindings?: Map<string, FindingsPayload>;
};

function cache(): Map<string, FindingsPayload> {
  if (!globalCache.__repodietFindings) {
    globalCache.__repodietFindings = new Map();
  }
  return globalCache.__repodietFindings;
}

export function storeFindings(payload: FindingsPayload): void {
  cache().set(payload.scanId, payload);
  setDurableRecord("findings", payload.scanId, payload);
}

export function getStoredFindings(scanId: string): FindingsPayload | undefined {
  const fromMemory = cache().get(scanId);
  if (fromMemory) return fromMemory;
  const fromDisk = getDurableRecord<FindingsPayload>("findings", scanId);
  if (fromDisk) cache().set(scanId, fromDisk);
  return fromDisk;
}

export function deleteStoredFindings(scanId: string): void {
  cache().delete(scanId);
  deleteDurableRecord("findings", scanId);
}
