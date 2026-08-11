/**
 * Durable, file-based store for buyer delete-approval requests — the
 * dynamic counterpart to job-delivery-approvals.ts's hardcoded array.
 *
 * When a delivery's only safe findings fall outside OPERATOR_SAFE_DIRS,
 * RepoDiet no longer just fails and waits for a developer to hand-review
 * and hardcode an approval (see job
 * 0xba4de4f576f0dbb05b0a88d2d889102dfb134f5e1c901bf0534312daf5d33402's
 * stranded 1 USDT escrow). It asks the BUYER directly, over the same
 * A2A/XMTP channel already used elsewhere, and records their reply here.
 *
 * Shared with openclaw-plugins/repodiet-a2a-bridge's own copy of this store
 * (pending-delete-approvals.js), which runs in a SEPARATE process (the
 * OpenClaw gateway child, not the seller-runtime child — see
 * scripts/seller-runtime-supervisor.ts) and therefore cannot share
 * in-memory state. Both sides read/write the SAME JSON file at the SAME
 * path convention openclaw-plugins/repodiet-a2a-bridge/idempotency.js
 * already uses ($XDG_DATA_HOME||$HOME||cwd)/repodiet-a2a-bridge/ —
 * co-located because approvals travel over the same a2a chat channel that
 * module owns. The two copies exist because the two packages are built and
 * run under different module systems and are never bundled together; the
 * file format is the actual contract between them, not a shared import.
 *
 * Deliberately dumb storage: this module never decides what is safe to
 * delete. It only remembers what was asked and what was answered. The
 * safety decision stays entirely in resolveValidatedDeliveryOps /
 * isApprovedValidatedDeletePath — see approvedDeletePathsForJob in
 * job-delivery-approvals.ts, the ONLY place a request recorded here can
 * actually widen delivery authority.
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

function writeStore(store: Record<string, BuyerDeleteApprovalRequest>): void {
  const dir = storeDir();
  fs.mkdirSync(dir, { recursive: true });
  // Write-then-rename, matching idempotency.js: a crash mid-write must never
  // leave a truncated, unparseable store.
  const tmp = path.join(dir, `.pending-delete-approvals.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(store), "utf8");
  fs.renameSync(tmp, storePath());
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
 */
export function createPendingDeleteApprovalRequest(input: {
  jobId: string;
  repositoryUrl: string;
  baseCommit: string;
  requestedPaths: string[];
}): BuyerDeleteApprovalRequest {
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
  writeStore(store);
  return record;
}

/**
 * Records the buyer's reply. No-ops (returns undefined) if there is no
 * PENDING request for this job — a reply to a request that was never sent,
 * already answered, or belongs to a stale baseCommit is never accepted as
 * an approval; the caller must not invent a match.
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
  writeStore(store);
  return updated;
}
