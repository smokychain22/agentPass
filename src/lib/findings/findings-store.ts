import type { FindingsPayload } from "./types";
import {
  deleteDurableRecord,
  getDurableRecord,
  setDurableRecord,
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

export async function storeFindings(payload: FindingsPayload): Promise<void> {
  await setDurableRecord("findings", payload.scanId, payload);
  cache().set(payload.scanId, payload);
}

export async function getStoredFindings(scanId: string): Promise<FindingsPayload | undefined> {
  const fromMemory = cache().get(scanId);
  if (fromMemory) return fromMemory;
  const fromStore = await getDurableRecord<FindingsPayload>("findings", scanId);
  if (fromStore) cache().set(scanId, fromStore);
  return fromStore;
}

export async function deleteStoredFindings(scanId: string): Promise<void> {
  cache().delete(scanId);
  await deleteDurableRecord("findings", scanId);
}
