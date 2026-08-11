/**
 * JS-side mirror of src/lib/okx-runtime/buyer-delete-approval-requests.ts —
 * same file, same schema, same path convention as idempotency.js
 * ($XDG_DATA_HOME||$HOME||cwd)/repodiet-a2a-bridge/, and the SAME
 * mkdir-EEXIST exclusive lock (mirroring action-ledger.ts's
 * FileActionLedger.tryLock) around every write, since this file and the
 * seller-runtime.ts process both write the same shared JSON blob from
 * separate OS processes. Two copies exist because this package and
 * src/lib/okx-runtime run under different module systems and are never
 * bundled together; the JSON file format is the actual contract between
 * them.
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

function writeStoreUnlocked(store) {
  const dir = storeDir();
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.pending-delete-approvals.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(store), "utf8");
  fs.renameSync(tmp, storePath());
}

const LOCK_STALE_MS = 5_000;
const LOCK_ACQUIRE_TIMEOUT_MS = 2_000;
const LOCK_RETRY_MS = 20;

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function lockPath() {
  return path.join(storeDir(), ".pending-delete-approvals.lock");
}

/** One attempt. Reclaims a stale lock only if its owning PID is provably dead. */
function tryAcquireLock() {
  const lock = lockPath();
  fs.mkdirSync(storeDir(), { recursive: true });

  try {
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, "owner"), String(process.pid), "utf8");
    return true;
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }

  try {
    const ownerFile = path.join(lock, "owner");
    const stat = fs.statSync(lock);
    const owner = Number(fs.readFileSync(ownerFile, "utf8").trim());
    const expired = Date.now() - stat.mtimeMs > LOCK_STALE_MS;
    if (Number.isFinite(owner) && processAlive(owner)) return false;
    if (!expired) return false;

    fs.rmSync(lock, { recursive: true, force: true });
    fs.mkdirSync(lock);
    fs.writeFileSync(ownerFile, String(process.pid), "utf8");
    return true;
  } catch {
    return false;
  }
}

function releaseLock() {
  try {
    fs.rmSync(lockPath(), { recursive: true, force: true });
  } catch {
    // Best effort — a leftover lock is recovered by the next writer's own
    // stale-lock reclaim once LOCK_STALE_MS has passed.
  }
}

/**
 * Runs `fn` under the exclusive lock. Returns `undefined` — never throws —
 * on acquisition timeout, matching the TS side exactly: every caller
 * already treats `undefined` as a safe no-op (the buyer's message falls
 * through to normal classification rather than being silently dropped or
 * crashing the reply hook).
 */
function withStoreLock(fn) {
  const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
  while (!tryAcquireLock()) {
    if (Date.now() >= deadline) return undefined;
    const until = Date.now() + LOCK_RETRY_MS;
    while (Date.now() < until) {
      // Synchronous brief spin-wait — separate OS processes, no event loop
      // to yield to; expected hold time is low single-digit milliseconds.
    }
  }
  try {
    return fn();
  } finally {
    releaseLock();
  }
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
 * baseCommit is never accepted as an approval. Also returns undefined on
 * lock contention.
 */
export function recordDeleteApprovalReply(jobId, outcome) {
  if (!jobId || !String(jobId).trim()) return undefined;
  return withStoreLock(() => {
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
    writeStoreUnlocked(store);
    return updated;
  });
}
