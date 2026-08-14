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

export async function storePatchKit(
  payload: PatchKitPayload,
  zipBuffer: Buffer,
  filename: string,
  scanId?: string
): Promise<void> {
  await setDurableRecord("patchKits", payload.id, {
    payload,
    filename,
    createdAt: new Date().toISOString(),
    scanId,
  });
  if (scanId) {
    await setDurableRecord("patchKitsByScan", scanId, { patchKitId: payload.id });
  }
  await writeArtifact(payload.id, zipBuffer, "zip");
}

export async function getPatchKitByScanId(scanId: string): Promise<StoredPatchKit | undefined> {
  const index = await getDurableRecord<{ patchKitId: string }>("patchKitsByScan", scanId);
  if (!index?.patchKitId) return undefined;
  return getStoredPatchKit(index.patchKitId);
}

/**
 * === Incident, 2026-08-14: a stale patch kit blocked its own delivery ===
 *
 * Discovered live proving the GitHub Actions sandbox worker end to end.
 * `patchkit_E6XRgS36NlVq` showed `patchValidation.status: "passed"` and
 * `summary.verifiedChanges: 1` via `/api/patch-kit/status/[id]` — but
 * `/api/github/create-cleanup-pr`, called immediately after, saw
 * `verifiedChanges: 0` and refused with "No verified source changes in
 * cleanup run." Both routes call this same function; the sandbox worker's
 * async completion callback (`persistSandboxResultsToPatchKit`) had already
 * written the passing result to durable storage by the time either ran.
 *
 * Root cause: this used to read-through an in-memory `Map` on
 * `globalThis`, populated at write time and never invalidated. That map is
 * PER SERVERLESS INSTANCE. `/api/patch-kit/generate` creates and caches the
 * kit at its initial `pending_sandbox` state on whichever instance handles
 * that request; if a LATER request (the delivery attempt) lands on that
 * SAME warm instance, it read the stale cached `pending_sandbox` copy
 * forever, never seeing the sandbox worker's update — which was written
 * from a different instance (the ingest callback) and could only reach
 * durable storage, not this instance's local memory. `/status` happened to
 * read correctly only because it also calls `reconcileSandboxRun`, which
 * re-persists fresh data (and thus refreshes that instance's own cache)
 * immediately before its own read.
 *
 * A patch kit's authoritative state can change from a different process at
 * any time (sandbox worker completion, retry, reconciliation) — there is no
 * way for one instance's in-memory cache to know when another instance has
 * written a newer version. Durable storage (Redis, or the local JSON file)
 * is already a fast, correct read on every call; the cache bought nothing
 * that a live read didn't already provide, cheaply, and cost correctness.
 */
export async function getStoredPatchKit(id: string): Promise<StoredPatchKit | undefined> {
  const meta = await getDurableRecord<{
    payload: PatchKitPayload;
    filename: string;
    createdAt: string;
  }>("patchKits", id);

  if (!meta) return undefined;

  const zipBuffer = await readArtifact(id, "zip");
  if (!zipBuffer) return undefined;

  return {
    payload: meta.payload,
    zipBuffer,
    filename: meta.filename,
    createdAt: meta.createdAt,
  };
}

export async function deleteStoredPatchKit(id: string): Promise<void> {
  await deleteDurableRecord("patchKits", id);
  await deleteArtifact(id, "zip");
}
