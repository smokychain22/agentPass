import { randomBytes } from "node:crypto";
import {
  deleteDurableRecord,
  durableNow,
  getDurableRecord,
  setDurableRecord,
  setDurableRecordIfAbsentWithTtl,
} from "@/lib/store/durable-store";
import type { BoundQuote, PaymentLifecycleStatus } from "./types";

/** In-progress fund lock TTL — expired locks can be reclaimed after a crash. */
export const A2A_FUND_LOCK_TTL_MS = 5 * 60 * 1000;

/** Persistent execution marker TTL on Redis (30 days). */
export const A2A_FUND_EXECUTION_MARKER_TTL_SECONDS = 30 * 24 * 60 * 60;

const A2A_FUND_LOCK_PREFIX = "a2a:fund:";

export interface A2aFundLockRecord {
  taskId: string;
  quoteId: string;
  paymentReference: string;
  executionQueued: boolean;
  fundedAt: string;
  payer?: string;
  lockToken: string;
  claimedAt: string;
  /** Set while executionQueued is false; cleared once execution is dispatched. */
  expiresAt?: string;
}

export interface PaymentRecord {
  id: string;
  quoteId: string;
  paymentReference: string;
  payer: string;
  amountMicro: string;
  nonce: string;
  idempotencyKey: string;
  lifecycleStatus: PaymentLifecycleStatus;
  taskId?: string;
  consumedAt?: string;
  createdAt: string;
}

function lockKey(taskId: string): string {
  return `${A2A_FUND_LOCK_PREFIX}${taskId}`;
}

function newLockToken(): string {
  return randomBytes(16).toString("hex");
}

export function isA2aFundLockExpired(lock: A2aFundLockRecord, nowMs = Date.now()): boolean {
  if (lock.executionQueued) return false;
  if (!lock.expiresAt) return false;
  return new Date(lock.expiresAt).getTime() <= nowMs;
}

export async function saveBoundQuote(quote: BoundQuote): Promise<void> {
  await setDurableRecord("task_quotes", quote.quoteId, quote);
}

export async function getBoundQuote(quoteId: string): Promise<BoundQuote | undefined> {
  return getDurableRecord<BoundQuote>("task_quotes", quoteId);
}

export async function updateBoundQuote(
  quoteId: string,
  patch: Partial<BoundQuote>
): Promise<BoundQuote | undefined> {
  const existing = await getBoundQuote(quoteId);
  if (!existing) return undefined;
  const updated = { ...existing, ...patch };
  await setDurableRecord("task_quotes", quoteId, updated);
  return updated;
}

export async function savePaymentRecord(record: PaymentRecord): Promise<void> {
  await setDurableRecord("payments", record.id, record);
  await setDurableRecord("payments", `ref_${record.paymentReference}`, record);
  await setDurableRecord("payments", `idem_${record.idempotencyKey}`, record);
  await setDurableRecord("payments", `quote_${record.quoteId}`, record);
}

export async function getPaymentByQuoteId(quoteId: string): Promise<PaymentRecord | undefined> {
  return getDurableRecord<PaymentRecord>("payments", `quote_${quoteId}`);
}

export async function getPaymentByReference(
  paymentReference: string
): Promise<PaymentRecord | undefined> {
  return getDurableRecord<PaymentRecord>("payments", `ref_${paymentReference}`);
}

export async function getPaymentByIdempotencyKey(
  idempotencyKey: string
): Promise<PaymentRecord | undefined> {
  return getDurableRecord<PaymentRecord>("payments", `idem_${idempotencyKey}`);
}

export async function lockQuoteForExecution(
  quoteId: string,
  taskId: string,
  paymentReference: string
): Promise<{ ok: boolean; reason?: string; quote?: BoundQuote }> {
  const quote = await getBoundQuote(quoteId);
  if (!quote) return { ok: false, reason: "Quote not found." };
  if (quote.status === "consumed") {
    if (quote.taskId === taskId) return { ok: true, quote };
    return { ok: false, reason: "Quote already consumed by another execution." };
  }
  if (quote.status !== "funded" && quote.lifecycleStatus !== "funded") {
    return { ok: false, reason: `Quote not funded (status=${quote.status}).` };
  }

  const updated: BoundQuote = {
    ...quote,
    status: "consumed",
    lifecycleStatus: "execution_started",
    taskId,
    paymentReference,
  };
  await setDurableRecord("task_quotes", quoteId, updated);
  return { ok: true, quote: updated };
}

export function markQuoteLifecycle(
  quote: BoundQuote,
  lifecycleStatus: PaymentLifecycleStatus
): BoundQuote {
  return { ...quote, lifecycleStatus, ...(lifecycleStatus === "expired" ? { status: "expired" } : {}) };
}

export async function persistQuoteLifecycle(
  quoteId: string,
  lifecycleStatus: PaymentLifecycleStatus,
  patch: Partial<BoundQuote> = {}
): Promise<BoundQuote | undefined> {
  const existing = await getBoundQuote(quoteId);
  if (!existing) return undefined;
  const updated = {
    ...existing,
    ...patch,
    lifecycleStatus,
    ...(lifecycleStatus === "expired" ? { status: "expired" as const } : {}),
    ...(lifecycleStatus === "funded" ? { status: "funded" as const } : {}),
    ...(lifecycleStatus === "completed" ? { status: "consumed" as const } : {}),
  };
  await setDurableRecord("task_quotes", quoteId, updated);
  return updated;
}

export function newPaymentRecord(input: {
  quoteId: string;
  paymentReference: string;
  payer: string;
  amountMicro: string;
  nonce: string;
  idempotencyKey: string;
  lifecycleStatus: PaymentLifecycleStatus;
  taskId?: string;
}): PaymentRecord {
  return {
    id: `pay_${input.paymentReference.slice(0, 24)}`,
    ...input,
    createdAt: durableNow(),
  };
}

export async function getA2aFundLock(taskId: string): Promise<A2aFundLockRecord | undefined> {
  const lock = await getDurableRecord<A2aFundLockRecord>("payment_entitlements", lockKey(taskId));
  if (!lock) return undefined;
  if (lock.executionQueued) return lock;
  if (isA2aFundLockExpired(lock)) {
    await deleteDurableRecord("payment_entitlements", lockKey(taskId));
    return undefined;
  }
  return lock;
}

export async function claimA2aFundLock(input: {
  taskId: string;
  quoteId: string;
  paymentReference: string;
  fundedAt: string;
  payer?: string;
}): Promise<{
  claimed: boolean;
  lockToken?: string;
  existing?: A2aFundLockRecord;
}> {
  const key = lockKey(input.taskId);
  const existing = await getDurableRecord<A2aFundLockRecord>("payment_entitlements", key);

  if (existing?.executionQueued) {
    return { claimed: false, existing };
  }

  if (existing && !isA2aFundLockExpired(existing)) {
    return { claimed: false, existing };
  }

  if (existing && isA2aFundLockExpired(existing)) {
    await deleteDurableRecord("payment_entitlements", key);
  }

  const lockToken = newLockToken();
  const claimedAt = durableNow();
  const expiresAt = new Date(Date.now() + A2A_FUND_LOCK_TTL_MS).toISOString();
  const record: A2aFundLockRecord = {
    ...input,
    executionQueued: false,
    lockToken,
    claimedAt,
    expiresAt,
  };

  const ttlSeconds = Math.ceil(A2A_FUND_LOCK_TTL_MS / 1000);
  const claimed = await setDurableRecordIfAbsentWithTtl(
    "payment_entitlements",
    key,
    record,
    ttlSeconds
  );
  if (!claimed) {
    const raced = await getDurableRecord<A2aFundLockRecord>("payment_entitlements", key);
    return { claimed: false, existing: raced };
  }
  return { claimed: true, lockToken };
}

/** Token-gated update — only the lock holder can mark execution dispatched. */
export async function markA2aFundExecutionQueued(
  taskId: string,
  lockToken: string,
  patch: Partial<A2aFundLockRecord> = {}
): Promise<boolean> {
  const key = lockKey(taskId);
  const existing = await getDurableRecord<A2aFundLockRecord>("payment_entitlements", key);
  if (!existing || existing.lockToken !== lockToken) return false;

  const updated: A2aFundLockRecord = {
    ...existing,
    ...patch,
    executionQueued: true,
    expiresAt: undefined,
  };
  await setDurableRecord("payment_entitlements", key, updated);
  return true;
}

/** Token-gated release for failed in-progress funding (never releases dispatched execution). */
export async function releaseA2aFundLockIfToken(taskId: string, lockToken: string): Promise<boolean> {
  const key = lockKey(taskId);
  const existing = await getDurableRecord<A2aFundLockRecord>("payment_entitlements", key);
  if (!existing || existing.lockToken !== lockToken || existing.executionQueued) return false;
  await deleteDurableRecord("payment_entitlements", key);
  return true;
}

/** @deprecated Use markA2aFundExecutionQueued with lockToken */
export async function saveA2aFundLock(record: A2aFundLockRecord): Promise<void> {
  await setDurableRecord("payment_entitlements", lockKey(record.taskId), record);
}
