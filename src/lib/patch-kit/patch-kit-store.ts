import type { PatchKitPayload } from "./types";

interface StoredPatchKit {
  payload: PatchKitPayload;
  zipBuffer: Buffer;
  filename: string;
  createdAt: string;
}

const globalCache = globalThis as unknown as {
  __repodietPatchKits?: Map<string, StoredPatchKit>;
};

function cache(): Map<string, StoredPatchKit> {
  if (!globalCache.__repodietPatchKits) {
    globalCache.__repodietPatchKits = new Map();
  }
  return globalCache.__repodietPatchKits;
}

export function storePatchKit(
  payload: PatchKitPayload,
  zipBuffer: Buffer,
  filename: string
): void {
  cache().set(payload.id, {
    payload,
    zipBuffer,
    filename,
    createdAt: new Date().toISOString(),
  });
}

export function getStoredPatchKit(id: string): StoredPatchKit | undefined {
  return cache().get(id);
}
