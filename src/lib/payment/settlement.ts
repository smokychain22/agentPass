import { createHash } from "node:crypto";
import type { CommerceOperation } from "@/lib/payment/types";
import {
  getBoundQuote,
  getPaymentByIdempotencyKey,
  getPaymentByReference,
  getPaymentByQuoteId,
  lockQuoteForExecution,
  newPaymentRecord,
  persistQuoteLifecycle,
  savePaymentRecord,
} from "./payment-store";
import {
  createBoundQuote,
  validateQuoteBinding,
  verifyTestPaymentPayload,
} from "./quote-service";
import type { BoundQuote, EntitlementContext, PaymentProof, PaymentVerificationResult } from "./types";
import { X402_CURRENCY, X402_NETWORK, X402_RECIPIENT } from "./constants";
import { applyFailurePolicy, type FailureScenario } from "./failure-policy";

function isRealX402(): boolean {
  return process.env.REQUIRE_REAL_X402 === "1";
}

function isTestX402(): boolean {
  return process.env.REPODIET_X402_TEST_MODE === "1" || !isRealX402();
}

export async function createQuoteForOperation(input: {
  repository: string;
  branch: string;
  commitSha: string;
  findingIds: string[];
  operation: CommerceOperation;
  sourceFileCount?: number;
  idempotencyKey?: string;
}): Promise<BoundQuote> {
  if (input.idempotencyKey) {
    const existing = await getPaymentByIdempotencyKey(input.idempotencyKey);
    if (existing?.taskId) {
      const quote = await getBoundQuote(existing.quoteId);
      if (quote) return quote;
    }
  }
  return createBoundQuote(input);
}

export async function verifyAndFundQuote(proof: PaymentProof): Promise<PaymentVerificationResult> {
  const quote = await getBoundQuote(proof.quoteId);
  if (!quote) {
    return { ok: false, status: "invalid_payment", reason: "Quote not found." };
  }

  if (quote.amountMicro === "0") {
    return { ok: true, status: "funded", quote };
  }

  if (
    quote.lifecycleStatus === "funded" &&
    quote.paymentStatus === "verified" &&
    quote.paymentReference
  ) {
    const existingPayment = await getPaymentByReference(quote.paymentReference);
    if (existingPayment?.lifecycleStatus === "funded" && existingPayment.quoteId === proof.quoteId) {
      return { ok: true, status: "funded", quote, reason: "Quote already verified." };
    }
  }

  await persistQuoteLifecycle(proof.quoteId, "payment_submitted");
  await persistQuoteLifecycle(proof.quoteId, "payment_verifying");

  const binding = validateQuoteBinding(quote, {
    repository: quote.repository,
    branch: quote.branch,
    commitSha: quote.commitSha,
    findingIds: quote.findingIds,
    operation: quote.operation,
  });
  if (!binding.ok) {
    const scenario = binding.status === "expired" ? "expired" : "invalid_payment";
    await persistQuoteLifecycle(proof.quoteId, binding.status ?? "invalid_payment");
    return { ok: false, status: binding.status ?? "invalid_payment", reason: binding.reason };
  }

  if (proof.nonce !== quote.nonce) {
    await persistQuoteLifecycle(proof.quoteId, "replayed");
    return { ok: false, status: "replayed", reason: "Nonce mismatch — possible replay." };
  }

  if (proof.amountMicro !== quote.amountMicro) {
    await persistQuoteLifecycle(proof.quoteId, "wrong_amount");
    return { ok: false, status: "wrong_amount", reason: "Payment amount does not match quote." };
  }

  if (proof.currency !== X402_CURRENCY) {
    await persistQuoteLifecycle(proof.quoteId, "wrong_token");
    return { ok: false, status: "wrong_token", reason: "Wrong currency." };
  }

  if (proof.network !== quote.network) {
    await persistQuoteLifecycle(proof.quoteId, "wrong_network");
    return { ok: false, status: "wrong_network", reason: "Wrong network." };
  }

  if (proof.recipient.toLowerCase() !== quote.recipient.toLowerCase()) {
    await persistQuoteLifecycle(proof.quoteId, "wrong_recipient");
    return { ok: false, status: "wrong_recipient", reason: "Wrong recipient." };
  }

  const existingRef = await getPaymentByReference(proof.paymentReference);
  if (existingRef && existingRef.quoteId !== proof.quoteId) {
    await persistQuoteLifecycle(proof.quoteId, "replayed");
    return { ok: false, status: "replayed", reason: "Payment reference already used." };
  }

  const existingIdem = await getPaymentByIdempotencyKey(proof.idempotencyKey);
  if (existingIdem) {
    if (existingIdem.lifecycleStatus === "funded" || existingIdem.lifecycleStatus === "completed") {
      const existingQuote = await getBoundQuote(existingIdem.quoteId);
      return {
        ok: true,
        status: "funded",
        quote: existingQuote,
        existingTaskId: existingIdem.taskId,
        reason: "Duplicate request — returning existing entitlement.",
      };
    }
  }

  const sigOk = await verifyPaymentSignature(proof, quote);
  if (!sigOk) {
    await persistQuoteLifecycle(proof.quoteId, "invalid_payment");
    return { ok: false, status: "invalid_payment", reason: "Payment signature verification failed." };
  }

  const funded = await persistQuoteLifecycle(proof.quoteId, "funded", {
    paymentReference: proof.paymentReference,
    payer: proof.payer,
    status: "funded",
    paymentStatus: "verified",
    fundedAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
  });

  const payment = newPaymentRecord({
    quoteId: proof.quoteId,
    paymentReference: proof.paymentReference,
    payer: proof.payer,
    amountMicro: proof.amountMicro,
    nonce: proof.nonce,
    idempotencyKey: proof.idempotencyKey,
    lifecycleStatus: "funded",
    taskId: proof.taskId,
  });
  await savePaymentRecord(payment);

  return { ok: true, status: "funded", quote: funded ?? quote };
}

async function verifyPaymentSignature(proof: PaymentProof, quote: BoundQuote): Promise<boolean> {
  if (isTestX402()) {
    const payload = {
      quoteId: proof.quoteId,
      paymentReference: proof.paymentReference,
      payer: proof.payer,
      amountMicro: proof.amountMicro,
      nonce: proof.nonce,
      requestHash: quote.requestHash,
    };
    if (proof.paymentSignature && verifyTestPaymentPayload(payload, proof.paymentSignature)) {
      return true;
    }
    if (process.env.REPODIET_X402_TEST_SECRET) {
      return false;
    }
    return true;
  }

  if (!proof.paymentSignature) return false;

  const facilitator = process.env.REPODIET_X402_FACILITATOR_URL;
  if (facilitator) {
    try {
      const res = await fetch(`${facilitator}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proof, quote }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return false;
      const json = (await res.json()) as { valid?: boolean };
      return json.valid === true;
    } catch {
      return false;
    }
  }

  return Boolean(proof.paymentSignature);
}

export async function requireEntitlement(
  context: EntitlementContext
): Promise<PaymentVerificationResult> {
  const quote = await getBoundQuote(context.quoteId);
  if (!quote) {
    return { ok: false, status: "invalid_payment", reason: "Quote not found." };
  }

  if (quote.amountMicro === "0") {
    return { ok: true, status: "funded", quote };
  }

  const payment = await getPaymentByQuoteId(context.quoteId);
  const postPaymentVerified =
    quote.paymentStatus === "verified" ||
    (payment?.lifecycleStatus === "funded" && Boolean(quote.paymentReference));

  if (postPaymentVerified && context.taskId) {
    if (quote.status === "consumed" && quote.taskId === context.taskId) {
      return { ok: true, status: "funded", quote };
    }
    const lock = await lockQuoteForExecution(
      context.quoteId,
      context.taskId,
      quote.paymentReference ?? payment?.paymentReference ?? ""
    );
    if (!lock.ok) {
      return { ok: false, status: "replayed", reason: lock.reason };
    }
    return { ok: true, status: "funded", quote: lock.quote };
  }

  const binding = validateQuoteBinding(quote, context);
  if (!binding.ok) {
    return { ok: false, status: binding.status ?? "invalid_payment", reason: binding.reason };
  }

  if (quote.status !== "funded" && quote.lifecycleStatus !== "funded") {
    return { ok: false, status: "payment_required", reason: "Payment required before execution." };
  }

  if (context.taskId) {
    const lock = await lockQuoteForExecution(context.quoteId, context.taskId, quote.paymentReference ?? "");
    if (!lock.ok) {
      return { ok: false, status: "replayed", reason: lock.reason };
    }
    return { ok: true, status: "funded", quote: lock.quote };
  }

  return { ok: true, status: "funded", quote };
}

export function paymentProofFromRequest(
  request: Request,
  body: Record<string, unknown>
): PaymentProof | null {
  const quoteId =
    (typeof body.quoteId === "string" ? body.quoteId : undefined) ??
    request.headers.get("x-repodiet-quote-id") ??
    undefined;
  if (!quoteId) return null;

  const paymentReference =
    (typeof body.paymentReference === "string" ? body.paymentReference : undefined) ??
    request.headers.get("x-payment-reference") ??
    `0x${createHash("sha256").update(`${quoteId}:${Date.now()}`).digest("hex").slice(0, 40)}`;

  const payer =
    (typeof body.payer === "string" ? body.payer : undefined) ??
    request.headers.get("x-payer") ??
    "0x0000000000000000000000000000000000000000";

  const idempotencyKey =
    (typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined) ??
    request.headers.get("idempotency-key") ??
    `idem_${quoteId}_${paymentReference}`;

  const paymentSignature =
    (typeof body.paymentSignature === "string" ? body.paymentSignature : undefined) ??
    request.headers.get("payment-signature") ??
    request.headers.get("x-payment-signature") ??
    undefined;

  const amountMicro =
    (typeof body.amountMicro === "string" ? body.amountMicro : undefined) ??
    request.headers.get("x-repodiet-demo-pay") ??
    undefined;

  return {
    quoteId,
    paymentReference,
    payer,
    amountMicro: amountMicro ?? "0",
    currency: X402_CURRENCY,
    network: X402_NETWORK,
    recipient: X402_RECIPIENT,
    nonce: typeof body.nonce === "string" ? body.nonce : "",
    idempotencyKey,
    paymentSignature: paymentSignature ?? undefined,
  };
}

export async function handleExecutionFailure(
  quoteId: string,
  scenario: FailureScenario
): Promise<{ action: string; lifecycleStatus: BoundQuote["lifecycleStatus"] }> {
  const policy = applyFailurePolicy(scenario);
  await persistQuoteLifecycle(quoteId, policy.lifecycleStatus as BoundQuote["lifecycleStatus"]);
  return policy;
}

export async function markQuoteCompleted(quoteId: string, taskId: string): Promise<void> {
  await persistQuoteLifecycle(quoteId, "completed", { taskId, status: "consumed" });
}
