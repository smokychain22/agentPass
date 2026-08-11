/**
 * Durable, file-based store for buyer delete-approval requests — the
 * dynamic counterpart to job-delivery-approvals.ts's hardcoded array.
 *
 * When a delivery's only safe findings fall outside OPERATOR_SAFE_DIRS,
 * RepoDiet no longer just fails and waits for a developer to hand-review
 * and hardcode an approval (see job
 * 0xba4de4f576f0dbb05b0a88d2d889102dfb134f5e1c901bf0534312daf5d33402's
 * stranded 1 USDT escrow). It asks the BUYER directly, over the same
 * A2A/XMTP channel already used elsewhere, and records the reply here.
 *
 * Shared with openclaw-plugins/repodiet-a2a-bridge's own copy of this store
 * (pending-delete-approvals.js), which runs in a SEPARATE process (the
 * OpenClaw gateway child, not the seller-runtime child — see
 * scripts/seller-runtime-supervisor.ts) and therefore cannot share
 * in-memory state. Both sides read/write the SAME JSON file at the SAME
 * path convention openclaw-plugins/repodiet-a2a-bridge/idempotency.js
 * already uses ($XDG_DATA_HOME||$HOME||cwd)/repodiet-a2a-bridge/ —
 * co-located because approvals travel over the same a2a chat channel that
 * module owns. Dockerfile.seller sets XDG_DATA_HOME=/persistent/data as an
 * image-level ENV, inherited by both children under
 * scripts/seller-runtime-supervisor.ts, so both processes resolve to the
 * SAME absolute path on the persistent volume — confirmed live: that
 * directory already holds idempotency.js's own dispatch-idempotency.json.
 * The two source files exist because the two packages are built and run
 * under different module systems and are never bundled together; the file
 * format is the actual contract between them, not a shared import.
 *
 * Deliberately dumb storage: this module never decides what is safe to
 * delete. It only remembers what was asked and what was answered. The
 * safety decision stays entirely in resolveValidatedDeliveryOps /
 * isApprovedValidatedDeletePath — see approvedDeletePathsForJob in
 * job-delivery-approvals.ts, the ONLY place a request recorded here can
 * actually widen delivery authority.
 *
 * Concurrency: two separate processes write this same file (a seller-runtime
 * retry creating a new pending request; the a2a-bridge recording a buyer's
 * reply), so a bare read-modify-write races a lost update. Every WRITE
 * acquires an exclusive lock first — `mkdir` is atomic on both POSIX and
 * Windows, so two racing processes cannot both win — mirroring
 * action-ledger.ts's FileActionLedger.tryLock exactly (same stale-lock
 * reclaim rule: only reclaim if the owning PID is provably dead). Reads are
 * never locked: write-then-rename means a reader only ever sees a complete
 * old or new file, never a torn one.
 */
import fs from "node:fs";
import path from "node:path";

export interface BuyerDeleteApprovalRequest {
  jobId: string;
  repositoryUrl: string;
  baseCommit: string;
  requestedPaths: string[];
  status: "pending" | "approved" | "declined";
  approvedPaths: string[];
  createdAt: string;
  respondedAt?: string;
}

function storeDir(): string {
  const base = process.env.XDG_DATA_HOME || process.env.HOME || process.cwd();
  return path.join(base, "repodiet-a2a-bridge");
}

function storePath(): string {
  return path.join(storeDir(), "pending-delete-approvals.json");
}

function readStore(): Record<string, BuyerDeleteApprovalRequest> {
  try {
    return JSON.parse(fs.readFileSync(storePath(), "utf8"));
  } catch {
    return {};
  }
}

function writeStoreUnlocked(store: Record<string, BuyerDeleteApprovalRequest>): void {
  const dir = storeDir();
  fs.mkdirSync(dir, { recursive: true });
  // PID-scoped temp name so two processes cannot collide on the same temp
  // file, then write-then-rename: a crash mid-write must never leave a
  // truncated, unparseable store.
  const tmp = path.join(dir, `.pending-delete-approvals.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(store), "utf8");
  fs.renameSync(tmp, storePath());
}

const LOCK_STALE_MS = 5_000;
const LOCK_ACQUIRE_TIMEOUT_MS = 2_000;
const LOCK_RETRY_MS = 20;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function lockPath(): string {
  return path.join(storeDir(), ".pending-delete-approvals.lock");
}

/** One attempt. Reclaims a stale lock only if its owning PID is provably dead. */
function tryAcquireLock(): boolean {
  const lock = lockPath();
  fs.mkdirSync(storeDir(), { recursive: true });

  try {
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, "owner"), String(process.pid), "utf8");
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
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

function releaseLock(): void {
  try {
    fs.rmSync(lockPath(), { recursive: true, force: true });
  } catch {
    // Best effort — a leftover lock is recovered by the next writer's own
    // stale-lock reclaim once LOCK_STALE_MS has passed.
  }
}

/**
 * Runs `fn` (a read-modify-write over the shared store) under the exclusive
 * lock. Returns `undefined` — never throws — if the lock cannot be acquired
 * within the timeout, so a rare contention spike degrades to "this write is
 * skipped this cycle" rather than crashing the caller. Every caller in this
 * file already treats `undefined` as a safe, retryable no-op.
 */
function withStoreLock<T>(fn: () => T): T | undefined {
  const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
  while (!tryAcquireLock()) {
    if (Date.now() >= deadline) return undefined;
    const until = Date.now() + LOCK_RETRY_MS;
    while (Date.now() < until) {
      // Synchronous brief spin-wait — these are separate OS processes, so
      // there is no event loop to yield to, and the expected hold time is
      // low single-digit milliseconds (one JSON parse + one file write).
    }
  }
  try {
    return fn();
  } finally {
    releaseLock();
  }
}

function normalizeKey(jobId: string): string {
  return jobId.trim().toLowerCase();
}

/** Reads the current request for a job, if any — regardless of status. */
export function getDeleteApprovalRequest(jobId: string): BuyerDeleteApprovalRequest | undefined {
  if (!jobId?.trim()) return undefined;
  return readStore()[normalizeKey(jobId)];
}

/**
 * Creates or replaces the pending request for a job. Replacing (not
 * merging) is deliberate: a new baseCommit means the repository moved
 * since any prior request, so the old requestedPaths/approval no longer
 * describe the current state and must not silently carry over.
 *
 * Returns `undefined` on lock contention — never throws. The caller
 * (deterministic-turn.ts) already treats "no request created this cycle"
 * as safe: the standard ~60s retry tries again.
 */
export function createPendingDeleteApprovalRequest(input: {
  jobId: string;
  repositoryUrl: string;
  baseCommit: string;
  requestedPaths: string[];
}): BuyerDeleteApprovalRequest | undefined {
  return withStoreLock(() => {
    const store = readStore();
    const record: BuyerDeleteApprovalRequest = {
      jobId: input.jobId,
      repositoryUrl: input.repositoryUrl,
      baseCommit: input.baseCommit,
      requestedPaths: [...input.requestedPaths],
      status: "pending",
      approvedPaths: [],
      createdAt: new Date().toISOString(),
    };
    store[normalizeKey(input.jobId)] = record;
    writeStoreUnlocked(store);
    return record;
  });
}

/**
 * Records the buyer's reply. No-ops (returns undefined) if there is no
 * PENDING request for this job — a reply to a request that was never sent,
 * already answered, or belongs to a stale baseCommit is never accepted as
 * an approval; the caller must not invent a match. Also returns undefined
 * on lock contention, indistinguishable from "no pending request" to every
 * caller, both of which are already safe no-ops.
 *
 * A partial `approvedPaths` is intersected against what was actually
 * requested — the buyer's reply can narrow the grant, never widen it to a
 * path nobody asked about.
 */
export function recordDeleteApprovalReply(
  jobId: string,
  outcome: { approved: boolean; approvedPaths?: string[] }
): BuyerDeleteApprovalRequest | undefined {
  if (!jobId?.trim()) return undefined;
  return withStoreLock(() => {
    const store = readStore();
    const key = normalizeKey(jobId);
    const existing = store[key];
    if (!existing || existing.status !== "pending") return undefined;

    const approvedPaths = outcome.approved
      ? outcome.approvedPaths && outcome.approvedPaths.length > 0
        ? outcome.approvedPaths.filter((p) => existing.requestedPaths.includes(p))
        : [...existing.requestedPaths]
      : [];

    const updated: BuyerDeleteApprovalRequest = {
      ...existing,
      status: outcome.approved ? "approved" : "declined",
      approvedPaths,
      respondedAt: new Date().toISOString(),
    };
    store[key] = updated;
    writeStoreUnlocked(store);
    return updated;
  });
}
