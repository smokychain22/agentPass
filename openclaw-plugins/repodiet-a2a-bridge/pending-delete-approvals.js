/**
 * JS-side mirror of src/lib/okx-runtime/buyer-delete-approval-requests.ts —
 * same file, same schema, same path convention as idempotency.js
 * ($XDG_DATA_HOME||$HOME||cwd)/repodiet-a2a-bridge/. Two copies exist
 * because this package and src/lib/okx-runtime run under different module
 * systems and are never bundled together; the JSON file format is the
 * actual contract between them.
 *
 * This side only ever READS a pending request and RECORDS a reply — the
 * request itself is only ever created from the seller-runtime side (the TS
 * copy), when a delivery attempt actually hits the safety gate.
 */
import fs from "node:fs";
import path from "node:path";

function storeDir() {
  const base = process.env.XDG_DATA_HOME || process.env.HOME || process.cwd();
  return path.join(base, "repodiet-a2a-bridge");
}

function storePath() {
  return path.join(storeDir(), "pending-delete-approvals.json");
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(storePath(), "utf8"));
  } catch {
    return {};
  }
}

function writeStore(store) {
  const dir = storeDir();
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.pending-delete-approvals.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(store), "utf8");
  fs.renameSync(tmp, storePath());
}

function normalizeKey(jobId) {
  return String(jobId).trim().toLowerCase();
}

/** Reads the current request for a job, if any — regardless of status. */
export function getDeleteApprovalRequest(jobId) {
  if (!jobId || !String(jobId).trim()) return undefined;
  return readStore()[normalizeKey(jobId)];
}

/**
 * Records the buyer's reply. No-ops (returns undefined) if there is no
 * PENDING request for this job — matches the TS side exactly: a reply to a
 * request that was never sent, already answered, or belongs to a stale
 * baseCommit is never accepted as an approval.
 */
export function recordDeleteApprovalReply(jobId, outcome) {
  if (!jobId || !String(jobId).trim()) return undefined;
  const store = readStore();
  const key = normalizeKey(jobId);
  const existing = store[key];
  if (!existing || existing.status !== "pending") return undefined;

  const updated = {
    ...existing,
    status: outcome.approved ? "approved" : "declined",
    approvedPaths: outcome.approved ? [...existing.requestedPaths] : [],
    respondedAt: new Date().toISOString(),
  };
  store[key] = updated;
  writeStore(store);
  return updated;
}
