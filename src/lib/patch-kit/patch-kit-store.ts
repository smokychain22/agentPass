import type { PatchKitPayload } from "./types";
import {
  getDurableRecord,
  setDurableRecord,
  deleteDurableRecord,
  writeArtifact,
  readArtifact,
  deleteArtifact,
} from "@/lib/store/durable-store";

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
  const record: StoredPatchKit = {
    payload,
    zipBuffer,
    filename,
    createdAt: new Date().toISOString(),
  };
  cache().set(payload.id, record);
  setDurableRecord("patchKits", payload.id, {
    payload,
    filename,
    createdAt: record.createdAt,
  });
  writeArtifact(payload.id, zipBuffer, "zip");
}

export function getStoredPatchKit(id: string): StoredPatchKit | undefined {
  const fromMemory = cache().get(id);
  if (fromMemory) return fromMemory;

  const meta = getDurableRecord<{
    payload: PatchKitPayload;
    filename: string;
    createdAt: string;
  }>("patchKits", id);

  if (!meta) return undefined;

  const zipBuffer = readArtifact(id, "zip");
  if (!zipBuffer) return undefined;

  const record: StoredPatchKit = {
    payload: meta.payload,
    zipBuffer,
    filename: meta.filename,
    createdAt: meta.createdAt,
  };
  cache().set(id, record);
  return record;
}

export function deleteStoredPatchKit(id: string): void {
  cache().delete(id);
  deleteDurableRecord("patchKits", id);
  deleteArtifact(id, "zip");
}
