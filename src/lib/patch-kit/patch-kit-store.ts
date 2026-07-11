import type { PatchKitPayload } from "./types";
import {
  deleteArtifact,
  deleteDurableRecord,
  getDurableRecord,
  readArtifact,
  setDurableRecord,
  writeArtifact,
} from "@/lib/store/durable-store";

interface StoredPatchKit {
  payload: PatchKitPayload;
  zipBuffer: Buffer;
  filename: string;
  createdAt: string;
  scanId?: string;
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

export async function storePatchKit(
  payload: PatchKitPayload,
  zipBuffer: Buffer,
  filename: string,
  scanId?: string
): Promise<void> {
  const record: StoredPatchKit = {
    payload,
    zipBuffer,
    filename,
    createdAt: new Date().toISOString(),
    scanId,
  };
  await setDurableRecord("patchKits", payload.id, {
    payload,
    filename,
    createdAt: record.createdAt,
    scanId,
  });
  if (scanId) {
    await setDurableRecord("patchKitsByScan", scanId, { patchKitId: payload.id });
  }
  await writeArtifact(payload.id, zipBuffer, "zip");
  cache().set(payload.id, record);
}

export async function getPatchKitByScanId(scanId: string): Promise<StoredPatchKit | undefined> {
  const index = await getDurableRecord<{ patchKitId: string }>("patchKitsByScan", scanId);
  if (!index?.patchKitId) return undefined;
  return getStoredPatchKit(index.patchKitId);
}

export async function getStoredPatchKit(id: string): Promise<StoredPatchKit | undefined> {
  const fromMemory = cache().get(id);
  if (fromMemory) return fromMemory;

  const meta = await getDurableRecord<{
    payload: PatchKitPayload;
    filename: string;
    createdAt: string;
  }>("patchKits", id);

  if (!meta) return undefined;

  const zipBuffer = await readArtifact(id, "zip");
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

export async function deleteStoredPatchKit(id: string): Promise<void> {
  cache().delete(id);
  await deleteDurableRecord("patchKits", id);
  await deleteArtifact(id, "zip");
}
