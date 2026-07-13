import {
  durableNow,
  getDurableRecord,
  setDurableRecord,
  setDurableRecordIfAbsent,
} from "@/lib/store/durable-store";
import type { BoundQuote, PaymentLifecycleStatus } from "./types";

export interface A2aFundLockRecord {
  taskId: string;
  quoteId: string;
  paymentReference: string;
  executionQueued: boolean;
  fundedAt: string;
  payer?: string;
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

const A2A_FUND_LOCK_PREFIX = "a2a:fund:";

export async function getA2aFundLock(taskId: string): Promise<A2aFundLockRecord | undefined> {
  return getDurableRecord<A2aFundLockRecord>("payment_entitlements", `${A2A_FUND_LOCK_PREFIX}${taskId}`);
}

export async function claimA2aFundLock(input: A2aFundLockRecord): Promise<{
  claimed: boolean;
  existing?: A2aFundLockRecord;
}> {
  const key = `${A2A_FUND_LOCK_PREFIX}${input.taskId}`;
  const claimed = await setDurableRecordIfAbsent("payment_entitlements", key, input);
  if (!claimed) {
    const existing = await getDurableRecord<A2aFundLockRecord>("payment_entitlements", key);
    return { claimed: false, existing };
  }
  return { claimed: true };
}

export async function saveA2aFundLock(record: A2aFundLockRecord): Promise<void> {
  await setDurableRecord("payment_entitlements", `${A2A_FUND_LOCK_PREFIX}${record.taskId}`, record);
}
