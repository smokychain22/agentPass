import { createHash } from "node:crypto";
import {
  createQuoteForOperation,
  markQuoteCompleted,
  requireEntitlement,
  verifyAndFundQuote,
} from "@/lib/payment/settlement";
import { quoteTo402Response } from "@/lib/payment/quote-service";
import { signExecutionReceipt } from "@/lib/operator/sign-receipt";
import {
  buildSignedReceiptV2,
  signSignedReceiptV2,
} from "@/lib/operator/signed-receipt-v2";
import type {
  OkxPaymentProvider,
  PaymentReceipt,
  PaymentRequirement,
  PaymentRequirementInput,
  PaymentSettlementInput,
  PaymentVerificationInput,
  SettlementResult,
  VerifiedPayment,
} from "./types";
import { getBoundQuote } from "@/lib/payment/payment-store";
import { getOkxReceipt, newReceiptId, saveOkxReceipt } from "./store";
import { getOperatorAgentId } from "./operator-identity";
import { QUICK_TRIAGE_AMOUNT } from "@/lib/payment/x402-config-validation";

function resultHash(payload: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

/** Wraps existing RepoDiet x402 payment stack — swap for OKX SDK when integrated. */
export class RepodietPaymentAdapter implements OkxPaymentProvider {
  async createRequirement(input: PaymentRequirementInput): Promise<PaymentRequirement> {
    const quote = await createQuoteForOperation({
      repository: input.repository,
      branch: input.branch,
      commitSha: input.commitSha,
      findingIds: input.findingIds ?? [],
      operation: input.serviceId as import("@/lib/payment/types").CommerceOperation,
      idempotencyKey: input.idempotencyKey,
      executionRequestHash: input.requestHash,
      resourceUrl: input.resourceUrl,
      requestMethod: input.requestMethod,
      requestPayloadHash: input.requestPayloadHash,
      amountMicroOverride:
        input.serviceId === "analyze_repository" ? QUICK_TRIAGE_AMOUNT : undefined,
    });

    return {
      quoteId: quote.quoteId,
      serviceId: input.serviceId,
      amount: quote.amount,
      amountMicro: quote.amountMicro,
      currency: "USDT",
      network: quote.network,
      recipient: quote.recipient,
      nonce: quote.nonce,
      expiresAt: quote.expiresAt,
      requestHash: quote.requestHash,
      x402Body: quoteTo402Response(quote, input.resourceUrl),
    };
  }

  async verifyPayment(input: PaymentVerificationInput): Promise<VerifiedPayment> {
    const quote = await getBoundQuote(input.quoteId);
    if (!quote) {
      return { ok: false, quoteId: input.quoteId, status: "invalid_payment", reason: "Quote not found." };
    }

    const result = await verifyAndFundQuote({
      quoteId: input.quoteId,
      paymentReference: input.paymentReference,
      payer: input.payer,
      amountMicro: input.amountMicro || quote.amountMicro,
      currency: "USDT",
      network: quote.network,
      recipient: quote.recipient,
      nonce: input.nonce || quote.nonce,
      idempotencyKey: input.idempotencyKey,
      paymentSignature: input.paymentSignature,
    });

    return {
      ok: result.ok,
      quoteId: input.quoteId,
      status: result.status,
      reason: result.reason,
      existingTaskId: result.existingTaskId,
    };
  }

  async settlePayment(input: PaymentSettlementInput): Promise<SettlementResult> {
    const entitlement = await requireEntitlement({
      quoteId: input.quoteId,
      taskId: input.taskId,
      repository: "",
      branch: "",
      commitSha: "",
      findingIds: [],
      operation: "analyze_repository",
    });
    if (!entitlement.ok) {
      return { ok: false, quoteId: input.quoteId, taskId: input.taskId, status: entitlement.status };
    }
    await markQuoteCompleted(input.quoteId, input.taskId);
    return { ok: true, quoteId: input.quoteId, taskId: input.taskId, status: "completed" };
  }

  async getReceipt(paymentId: string): Promise<PaymentReceipt | undefined> {
    return getOkxReceipt(paymentId);
  }
}

export function createPaymentProvider(): OkxPaymentProvider {
  return new RepodietPaymentAdapter();
}

export async function signOkxReceipt(input: {
  serviceId: string;
  serviceType: "A2MCP" | "A2A";
  taskId: string;
  requestHash: string;
  result: unknown;
  quoteId?: string;
  paymentReference?: string;
  buyer?: string;
  seller?: string;
  amountMicro?: string;
  token?: string;
  network?: string;
  operation?: string;
  repository?: string;
  commitSha?: string;
  /** Authorized quote commercial digest — must not be replaced by an execution binding digest. */
  quoteRequestDigest?: string;
  /** Narrower commerce-binding digest used at request gate time. */
  executionRequestDigest?: string;
}): Promise<PaymentReceipt> {
  const receiptId = newReceiptId();
  const hash = resultHash(input.result);
  const timestamp = new Date().toISOString();
  const quoteRequestDigest = input.quoteRequestDigest ?? input.requestHash;
  const executionRequestDigest =
    input.executionRequestDigest && input.executionRequestDigest !== quoteRequestDigest
      ? input.executionRequestDigest
      : undefined;
  // Keep SignedReceiptV1 for backward compatibility with historical verifiers.
  const signedV1 = signExecutionReceipt({
    taskId: input.taskId,
    repository: input.repository ?? "",
    commitSha: input.commitSha ?? "",
    findingIds: [],
    patchHash: hash,
    verificationHash: hash,
    status: "verified",
    quoteId: input.quoteId,
    paymentReference: input.paymentReference,
    timestamp,
  });

  // Future path: SignedReceiptV2 includes both digests + commerce bindings in the signed payload.
  const signedV2 = signSignedReceiptV2(
    buildSignedReceiptV2({
      quoteId: input.quoteId ?? "",
      quoteRequestDigest,
      executionRequestDigest: executionRequestDigest ?? quoteRequestDigest,
      transactionHash: input.paymentReference ?? "",
      paymentReference: input.paymentReference ?? "",
      taskId: input.taskId,
      buyer: input.buyer ?? "",
      seller: input.seller ?? "",
      amount: input.amountMicro
        ? (Number(input.amountMicro) / 1_000_000).toFixed(2)
        : "",
      amountMicro: input.amountMicro ?? "",
      token: input.token ?? "",
      network: input.network ?? "",
      operation: input.operation ?? "",
      repository: input.repository ?? "",
      resultDigest: hash,
      completionTimestamp: timestamp,
    })
  );

  const receipt: PaymentReceipt = {
    receiptId,
    serviceId: input.serviceId as PaymentReceipt["serviceId"],
    serviceType: input.serviceType,
    taskId: input.taskId,
    // Primary requestHash is always the buyer-authorized quote digest.
    requestHash: quoteRequestDigest,
    quoteRequestDigest,
    executionRequestDigest,
    resultHash: hash,
    resultDigest: hash,
    signature: signedV1.signature ?? undefined,
    signedReceipt: signedV1.signedReceipt as unknown as Record<string, unknown>,
    signedReceiptV2: signedV2.signedReceipt as unknown as Record<string, unknown>,
    signatureV2: signedV2.signature ?? undefined,
    operatorAgentId: getOperatorAgentId(),
    timestamp,
    completedAt: timestamp,
    quoteId: input.quoteId,
    paymentReference: input.paymentReference,
    buyer: input.buyer,
    seller: input.seller,
    amountMicro: input.amountMicro,
    token: input.token,
    network: input.network,
    operation: input.operation,
    repository: input.repository,
    commitSha: input.commitSha,
  };
  await saveOkxReceipt(receipt);
  return receipt;
}
