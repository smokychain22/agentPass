import type { A2ATaskRecord } from "@/lib/a2a/types";
import type { OkxOrderRecord } from "@/lib/okx/types";
import { X402_ASSET, X402_CURRENCY, X402_NETWORK, X402_RECIPIENT } from "@/lib/payment/constants";
import {
  getPaymentByQuoteId,
  getPaymentByReference,
  updateBoundQuote,
  type PaymentRecord,
} from "@/lib/payment/payment-store";
import type { BoundQuote, PaymentProof } from "@/lib/payment/types";

export interface A2aFundValidationInput {
  task: A2ATaskRecord;
  quote: BoundQuote;
  order?: OkxOrderRecord;
  expectedQuoteId?: string;
  expectedPayer?: string;
  expectedPaymentReference?: string;
}

export interface A2aFundValidationResult {
  ok: boolean;
  code?:
    | "quote_not_found"
    | "quote_not_funded"
    | "payment_not_verified"
    | "quote_task_mismatch"
    | "order_quote_mismatch"
    | "order_task_mismatch"
    | "payer_mismatch"
    | "recipient_mismatch"
    | "amount_mismatch"
    | "asset_mismatch"
    | "network_mismatch"
    | "quote_consumed"
    | "payment_reference_missing";
  reason?: string;
  payment?: PaymentRecord;
}

export function quoteIdForTask(task: A2ATaskRecord): string | undefined {
  const receiptQuote = task.result?.receipt?.quote as { quoteId?: string } | undefined;
  if (receiptQuote?.quoteId) return receiptQuote.quoteId;
  return task.input.quoteId;
}

export function isQuoteVerified(quote: BoundQuote, payment?: PaymentRecord): boolean {
  if (!quote.paymentReference || !quote.payer) return false;
  if (!payment || payment.lifecycleStatus !== "funded") return false;
  if (payment.quoteId !== quote.quoteId) return false;
  if (payment.paymentReference !== quote.paymentReference) return false;
  if (payment.payer.toLowerCase() !== quote.payer.toLowerCase()) return false;
  if (quote.paymentStatus && quote.paymentStatus !== "verified") return false;
  return true;
}

/** Backfill authoritative paymentStatus from server-side payment records (pre-migration quotes). */
export async function hydrateVerifiedQuoteFromPayment(
  quote: BoundQuote
): Promise<{ quote: BoundQuote; payment?: PaymentRecord }> {
  if (quote.paymentStatus === "verified") {
    const payment =
      (quote.paymentReference
        ? await getPaymentByReference(quote.paymentReference)
        : undefined) ?? (await getPaymentByQuoteId(quote.quoteId));
    return { quote, payment };
  }

  const payment =
    (quote.paymentReference
      ? await getPaymentByReference(quote.paymentReference)
      : undefined) ?? (await getPaymentByQuoteId(quote.quoteId));

  if (
    !payment ||
    payment.lifecycleStatus !== "funded" ||
    payment.quoteId !== quote.quoteId
  ) {
    return { quote };
  }

  if (
    quote.payer &&
    payment.payer.toLowerCase() !== quote.payer.toLowerCase()
  ) {
    return { quote };
  }

  if (
    quote.paymentReference &&
    payment.paymentReference !== quote.paymentReference
  ) {
    return { quote };
  }

  const now = quote.verifiedAt ?? quote.fundedAt ?? payment.createdAt;
  const nextLifecycle =
    quote.lifecycleStatus === "funded" ||
    quote.lifecycleStatus === "execution_started" ||
    quote.lifecycleStatus === "completed"
      ? quote.lifecycleStatus
      : "funded";
  const nextStatus =
    quote.status === "consumed" || quote.status === "funded" ? quote.status : "funded";

  const patched = await updateBoundQuote(quote.quoteId, {
    paymentStatus: "verified",
    paymentReference: quote.paymentReference ?? payment.paymentReference,
    payer: quote.payer ?? payment.payer,
    fundedAt: quote.fundedAt ?? payment.createdAt,
    verifiedAt: now,
    lifecycleStatus: nextLifecycle,
    status: nextStatus,
  });

  return { quote: patched ?? { ...quote, paymentStatus: "verified" }, payment };
}

export async function validateVerifiedQuoteForA2aFund(
  input: A2aFundValidationInput
): Promise<A2aFundValidationResult> {
  const { task, order } = input;
  let { quote } = input;
  const boundQuoteId = input.expectedQuoteId ?? quoteIdForTask(task) ?? quote.quoteId;

  if (quote.quoteId !== boundQuoteId) {
    return { ok: false, code: "quote_task_mismatch", reason: "Quote does not belong to this task." };
  }

  if (task.input.contractDigest && quote.contractDigest !== task.input.contractDigest) {
    return {
      ok: false,
      code: "quote_task_mismatch",
      reason: "Quote is not bound to the task maintenance contract.",
    };
  }
  if (order?.contractDigest && quote.contractDigest !== order.contractDigest) {
    return {
      ok: false,
      code: "order_quote_mismatch",
      reason: "Quote is not bound to the order maintenance contract.",
    };
  }

  if (order) {
    if (order.a2aTaskId && order.a2aTaskId !== task.id) {
      return { ok: false, code: "order_task_mismatch", reason: "Order does not belong to this task." };
    }
    if (order.quoteId && order.quoteId !== quote.quoteId) {
      return { ok: false, code: "order_quote_mismatch", reason: "Order quote mismatch." };
    }
    if (order.amountMicro && order.amountMicro !== quote.amountMicro) {
      return { ok: false, code: "amount_mismatch", reason: "Order amount mismatch." };
    }
  }

  if (quote.a2aTaskId && quote.a2aTaskId !== task.id) {
    return { ok: false, code: "quote_consumed", reason: "Quote is bound to another task." };
  }

  const paymentHint =
    (quote.paymentReference
      ? await getPaymentByReference(quote.paymentReference)
      : undefined) ?? (await getPaymentByQuoteId(quote.quoteId));

  if (quote.status === "consumed" && quote.taskId && quote.taskId !== task.id) {
    const paymentOwned =
      paymentHint &&
      paymentHint.lifecycleStatus === "funded" &&
      paymentHint.quoteId === quote.quoteId &&
      (!paymentHint.taskId || paymentHint.taskId === task.id);
    if (!paymentOwned) {
      return { ok: false, code: "quote_consumed", reason: "Quote already consumed by another task." };
    }
  }

  const hydrated = await hydrateVerifiedQuoteFromPayment(quote);
  quote = hydrated.quote;
  const payment = hydrated.payment ?? paymentHint;

  const verifiedPaymentForTask =
    Boolean(payment) &&
    payment!.lifecycleStatus === "funded" &&
    payment!.quoteId === quote.quoteId &&
    (!payment!.taskId || payment!.taskId === task.id);

  const fundedForThisTask =
    verifiedPaymentForTask &&
    Boolean(quote.paymentReference ?? payment?.paymentReference) &&
    (quote.lifecycleStatus === "funded" ||
      quote.lifecycleStatus === "execution_started" ||
      quote.status === "consumed" ||
      quote.status === "funded");

  if (!fundedForThisTask) {
    if (quote.lifecycleStatus !== "funded" || quote.status !== "funded") {
      return { ok: false, code: "quote_not_funded", reason: "Quote is not funded." };
    }
  }

  if (!quote.paymentReference) {
    return { ok: false, code: "payment_reference_missing", reason: "Quote has no payment reference." };
  }

  if (input.expectedPaymentReference && quote.paymentReference !== input.expectedPaymentReference) {
    return {
      ok: false,
      code: "payment_reference_missing",
      reason: "Payment reference does not match the funded quote.",
    };
  }

  if (quote.paymentStatus !== "verified") {
    return { ok: false, code: "payment_not_verified", reason: "Quote payment is not verified." };
  }

  if (quote.recipient.toLowerCase() !== X402_RECIPIENT.toLowerCase()) {
    return { ok: false, code: "recipient_mismatch", reason: "Quote recipient mismatch." };
  }

  if (quote.currency !== X402_CURRENCY) {
    return { ok: false, code: "amount_mismatch", reason: "Quote currency mismatch." };
  }

  if (quote.network !== X402_NETWORK) {
    return { ok: false, code: "network_mismatch", reason: "Quote network mismatch." };
  }

  if (quote.asset.toLowerCase() !== X402_ASSET.toLowerCase()) {
    return { ok: false, code: "asset_mismatch", reason: "Quote asset mismatch." };
  }

  const expectedPayer = input.expectedPayer ?? order?.payer ?? quote.payer;
  if (expectedPayer && quote.payer?.toLowerCase() !== expectedPayer.toLowerCase()) {
    return { ok: false, code: "payer_mismatch", reason: "Quote payer mismatch." };
  }

  if (order?.payer && quote.payer?.toLowerCase() !== order.payer.toLowerCase()) {
    return { ok: false, code: "payer_mismatch", reason: "Quote payer does not match order buyer." };
  }

  if (!payment || !isQuoteVerified(quote, payment)) {
    return {
      ok: false,
      code: "payment_not_verified",
      reason: "Verified payment record not found for funded quote.",
    };
  }

  if (expectedPayer && payment.payer.toLowerCase() !== expectedPayer.toLowerCase()) {
    return { ok: false, code: "payer_mismatch", reason: "Payment payer mismatch." };
  }

  if (payment.amountMicro !== quote.amountMicro) {
    return { ok: false, code: "amount_mismatch", reason: "Payment amount mismatch." };
  }

  if (payment.taskId && payment.taskId !== task.id) {
    return { ok: false, code: "quote_consumed", reason: "Payment already bound to another task." };
  }

  return { ok: true, payment };
}

export function buildVerifiedQuotePatch(proof: PaymentProof): Partial<BoundQuote> {
  const now = new Date().toISOString();
  return {
    paymentReference: proof.paymentReference,
    payer: proof.payer,
    paymentStatus: "verified",
    fundedAt: now,
    verifiedAt: now,
    lifecycleStatus: "funded",
    status: "funded",
  };
}

export const A2A_FUNDABLE_STATUSES = new Set([
  "awaiting_payment",
  "quote_required",
  "payment_failed",
]);

export const A2A_FUNDED_OR_EXECUTING_STATUSES = new Set([
  "funded",
  "queued",
  "fetching_repository",
  "analyzing",
  "generating_changes",
  "validating_patch",
  "verifying",
  "awaiting_approval",
  "creating_pull_request",
  "completed",
]);
