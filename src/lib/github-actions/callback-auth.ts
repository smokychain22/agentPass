import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  getPersistentRecord,
  setPersistentRecord,
  deletePersistentRecord,
} from "@/lib/store/persistent-store";

const NONCE_COLLECTION = "actions_dispatch" as const;
const DEFAULT_SKEW_MS = 5 * 60 * 1000;

export type ActionsCallbackPayload = {
  jobId: string;
  workflowRunId: string;
  workflowRunAttempt: string;
  workflowName: string;
  repository: string;
  completionNonce: string;
  timestamp: string;
  resultDigest?: string;
  stage?: string;
  code?: string;
};

function readCallbackSecret(): string | undefined {
  return process.env.WORKER_CALLBACK_SECRET?.trim() || undefined;
}

/** Canonical string for HMAC — stable key order. */
export function canonicalCallbackString(payload: ActionsCallbackPayload): string {
  return [
    payload.jobId,
    payload.workflowRunId,
    payload.workflowRunAttempt,
    payload.workflowName,
    payload.repository,
    payload.completionNonce,
    payload.timestamp,
    payload.resultDigest ?? "",
    payload.stage ?? "",
    payload.code ?? "",
  ].join("\n");
}

export function signActionsCallback(
  payload: ActionsCallbackPayload,
  secret?: string
): string {
  const key = secret ?? readCallbackSecret();
  if (!key) throw new Error("WORKER_CALLBACK_SECRET is not configured.");
  return createHmac("sha256", key).update(canonicalCallbackString(payload)).digest("hex");
}

export function verifyActionsCallbackSignature(
  payload: ActionsCallbackPayload,
  signature: string | null | undefined,
  secret?: string
): boolean {
  const key = secret ?? readCallbackSecret();
  if (!key || !signature?.trim()) return false;
  const provided = signature.trim().replace(/^sha256=/i, "");
  const expected = signActionsCallback(payload, key);
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function createCompletionNonce(): string {
  return `cn_${randomBytes(18).toString("hex")}`;
}

export function createClaimHandle(): string {
  return `ch_${randomBytes(16).toString("hex")}`;
}

/** Progress-only token for secretless analyze callbacks (not Worker API key / callback secret). */
export function createProgressToken(): string {
  return `pt_${randomBytes(24).toString("hex")}`;
}

export function hashProgressToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyProgressToken(
  token: string | null | undefined,
  expectedHash: string | null | undefined
): boolean {
  if (!token?.trim() || !expectedHash?.trim()) return false;
  const provided = hashProgressToken(token.trim());
  if (provided.length !== expectedHash.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expectedHash));
  } catch {
    return false;
  }
}

export async function consumeCompletionNonce(
  nonce: string,
  jobId: string
): Promise<boolean> {
  const key = `completion:${nonce}`;
  const existing = await getPersistentRecord<{ jobId: string; usedAt?: string }>(
    NONCE_COLLECTION,
    key
  );
  if (existing?.usedAt) return false;
  if (existing && existing.jobId !== jobId) return false;

  // Reserve / mark used atomically-ish: write used marker.
  const prior = await getPersistentRecord<{ jobId: string; usedAt?: string }>(
    NONCE_COLLECTION,
    key
  );
  if (prior?.usedAt) return false;
  await setPersistentRecord(NONCE_COLLECTION, key, {
    jobId,
    usedAt: new Date().toISOString(),
  });
  return true;
}

export async function reserveCompletionNonce(nonce: string, jobId: string): Promise<void> {
  await setPersistentRecord(NONCE_COLLECTION, `completion:${nonce}`, {
    jobId,
    createdAt: new Date().toISOString(),
  });
}

export async function invalidateCompletionNonce(nonce: string): Promise<void> {
  await deletePersistentRecord(NONCE_COLLECTION, `completion:${nonce}`);
}

export function assertCallbackTimestampFresh(
  timestamp: string,
  skewMs = DEFAULT_SKEW_MS
): boolean {
  const t = Date.parse(timestamp);
  if (!Number.isFinite(t)) return false;
  return Math.abs(Date.now() - t) <= skewMs;
}

export class ActionsCallbackAuthError extends Error {
  constructor(
    public readonly code:
      | "CALLBACK_SECRET_MISSING"
      | "CALLBACK_SIGNATURE_INVALID"
      | "CALLBACK_TIMESTAMP_STALE"
      | "COMPLETION_NONCE_REPLAY"
      | "WORKFLOW_IDENTITY_MISMATCH"
      | "CLAIM_LEASE_INVALID"
      | "PROGRESS_TOKEN_INVALID",
    message: string
  ) {
    super(message);
    this.name = "ActionsCallbackAuthError";
  }
}
