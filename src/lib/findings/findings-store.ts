import type { FindingsPayload } from "./types";

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
}

export function getStoredFindings(scanId: string): FindingsPayload | undefined {
  return cache().get(scanId);
}
