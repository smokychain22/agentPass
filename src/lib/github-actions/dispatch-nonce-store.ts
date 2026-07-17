import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  getPersistentRecord,
  setPersistentRecord,
  deletePersistentRecord,
} from "@/lib/store/persistent-store";

const COLLECTION = "actions_dispatch" as const;
const NONCE_TTL_MS = 60 * 60_000;

export interface DispatchNonceRecord {
  nonce: string;
  jobId: string;
  tenantId?: string;
  requestId: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  workflowRunId?: string;
}

export function createDispatchNonce(): string {
  return `dn_${randomBytes(18).toString("hex")}`;
}

export function analysisConfigDigest(input: {
  tenantId?: string;
  structureScanId?: string;
  repository: string;
  branch: string;
  sourceCommit: string;
  projectRoot: string;
}): string {
  const raw = [
    input.tenantId ?? "",
    input.structureScanId ?? "",
    input.repository.toLowerCase(),
    input.branch,
    input.sourceCommit,
    input.projectRoot || ".",
    "readonly-findings-v1",
  ].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

export async function storeDispatchNonce(record: DispatchNonceRecord): Promise<void> {
  await setPersistentRecord(COLLECTION, `nonce:${record.nonce}`, record);
  await setPersistentRecord(COLLECTION, `job_nonce:${record.jobId}`, record.nonce);
}

export async function getDispatchNonce(nonce: string): Promise<DispatchNonceRecord | undefined> {
  return getPersistentRecord<DispatchNonceRecord>(COLLECTION, `nonce:${nonce}`);
}

export async function getJobDispatchNonce(jobId: string): Promise<string | undefined> {
  return getPersistentRecord<string>(COLLECTION, `job_nonce:${jobId}`);
}

/** Consume nonce once. Returns null if missing, expired, or already used. */
export async function consumeDispatchNonce(
  nonce: string,
  jobId: string
): Promise<DispatchNonceRecord | null> {
  const record = await getDispatchNonce(nonce);
  if (!record || record.jobId !== jobId) return null;
  if (record.usedAt) return null;
  if (Date.parse(record.expiresAt) <= Date.now()) return null;
  const used: DispatchNonceRecord = {
    ...record,
    usedAt: new Date().toISOString(),
  };
  await setPersistentRecord(COLLECTION, `nonce:${nonce}`, used);
  return used;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

export function dispatchNonceTtlMs(): number {
  return NONCE_TTL_MS;
}

export async function clearDispatchNonce(nonce: string): Promise<void> {
  await deletePersistentRecord(COLLECTION, `nonce:${nonce}`);
}
