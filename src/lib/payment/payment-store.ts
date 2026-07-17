import { randomBytes } from "node:crypto";
import {
  deleteDurableRecord,
  durableNow,
  getDurableRecord,
  setDurableRecord,
  setDurableRecordIfAbsentWithTtl,
} from "@/lib/store/durable-store";
import type { BoundQuote, PaymentLifecycleStatus } from "./types";
import { isMisConsumedWithoutDelivery } from "./quote-repair";

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

/** Lease for in-flight EXECUTING quotes — expired leases may be reclaimed for retry. */
export const QUOTE_EXECUTING_LEASE_MS = 90_000;

export interface QuoteLockResult {
  ok: boolean;
  reason?: string;
  quote?: BoundQuote;
  alreadyCompleted?: boolean;
  pending?: boolean;
}

function isExecutingLeaseActive(quote: BoundQuote, nowMs = Date.now()): boolean {
  if (quote.executionState !== "EXECUTING") return false;
  if (!quote.executionStartedAt) return true;
  return nowMs - new Date(quote.executionStartedAt).getTime() < QUOTE_EXECUTING_LEASE_MS;
}

/**
 * Begin paid execution. Does NOT mark the quote consumed.
 * Consumption happens only on successful delivery via markQuoteSucceeded.
 */
export async function lockQuoteForExecution(
  quoteId: string,
  taskId: string,
  paymentReference: string
): Promise<QuoteLockResult> {
  const quote = await getBoundQuote(quoteId);
  if (!quote) return { ok: false, reason: "Quote not found." };

  if (quote.executionState === "SUCCEEDED" || quote.lifecycleStatus === "completed") {
    return {
      ok: false,
      alreadyCompleted: true,
      reason: "Quote already completed successfully.",
      quote,
    };
  }

  if (quote.executionState === "FAILED_FINAL" || quote.status === "refunded") {
    return { ok: false, reason: "Quote is no longer usable for execution.", quote };
  }

  if (quote.executionState === "EXECUTING" && quote.taskId === taskId) {
    return { ok: true, quote };
  }

  if (quote.executionState === "EXECUTING" && quote.taskId !== taskId && isExecutingLeaseActive(quote)) {
    return {
      ok: false,
      pending: true,
      reason: "Execution already in progress for this funded quote.",
      quote,
    };
  }

  const fundedLike =
    quote.status === "funded" ||
    quote.lifecycleStatus === "funded" ||
    quote.executionState === "FUNDED" ||
    quote.executionState === "FAILED_RETRYABLE" ||
    isMisConsumedWithoutDelivery(quote) ||
    // reclaim stale EXECUTING lease
    (quote.executionState === "EXECUTING" && !isExecutingLeaseActive(quote));

  if (!fundedLike) {
    if (quote.status === "consumed") {
      return { ok: false, reason: "Quote already consumed by another execution.", quote };
    }
    return { ok: false, reason: `Quote not funded (status=${quote.status}).`, quote };
  }

  const updated: BoundQuote = {
    ...quote,
    // Stay funded until successful delivery — never permanently consume on start.
    status: "funded",
    lifecycleStatus: "execution_started",
    executionState: "EXECUTING",
    executionStartedAt: durableNow(),
    taskId,
    paymentReference: paymentReference || quote.paymentReference,
    lastFailureReason: undefined,
  };
  await setDurableRecord("task_quotes", quoteId, updated);
  return { ok: true, quote: updated };
}

/** Restore funded entitlement after timeout or platform failure so buyer is not charged again. */
export async function releaseQuoteForRetryableFailure(
  quoteId: string,
  taskId: string,
  reason: string
): Promise<BoundQuote | undefined> {
  const quote = await getBoundQuote(quoteId);
  if (!quote) return undefined;
  if (quote.executionState === "SUCCEEDED" || quote.lifecycleStatus === "completed") {
    return quote;
  }
  const updated: BoundQuote = {
    ...quote,
    status: "funded",
    lifecycleStatus: "funded",
    executionState: "FAILED_RETRYABLE",
    lastFailureReason: reason,
    lastFailedTaskId: taskId,
    taskId: undefined,
  };
  await setDurableRecord("task_quotes", quoteId, updated);
  return updated;
}

/** Mark successful delivery — only then may the quote become consumed. */
export async function markQuoteSucceeded(
  quoteId: string,
  taskId: string,
  receiptId?: string
): Promise<BoundQuote | undefined> {
  const quote = await getBoundQuote(quoteId);
  if (!quote) return undefined;
  const updated: BoundQuote = {
    ...quote,
    status: "consumed",
    lifecycleStatus: "completed",
    executionState: "SUCCEEDED",
    executionCompletedAt: durableNow(),
    taskId,
    completedTaskId: taskId,
    completedReceiptId: receiptId,
    lastFailureReason: undefined,
  };
  await setDurableRecord("task_quotes", quoteId, updated);
  return updated;
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
    ...(lifecycleStatus === "funded"
      ? {
          status: "funded" as const,
          executionState: (patch.executionState ?? "FUNDED") as BoundQuote["executionState"],
        }
      : {}),
    ...(lifecycleStatus === "completed"
      ? {
          status: "consumed" as const,
          executionState: (patch.executionState ?? "SUCCEEDED") as BoundQuote["executionState"],
        }
      : {}),
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
