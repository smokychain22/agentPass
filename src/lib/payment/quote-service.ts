import { createHash, createHmac, randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import type { CommerceOperation } from "./types";
import { resolveCommercePrice } from "@/lib/pricing/commerce-price";
import {
  QUOTE_TTL_MS,
  X402_ASSET,
  X402_CURRENCY,
  X402_NETWORK,
  X402_RECIPIENT,
} from "./constants";
import { saveBoundQuote } from "./payment-store";
import type { BoundQuote, VerificationProfile } from "./types";
import { paymentRequiredBody } from "./x402";

function microToAmount(micro: string): string {
  const n = Number(micro);
  return (n / 1_000_000).toFixed(2);
}

function requestHash(parts: Record<string, string | string[]>): string {
  const canonical = JSON.stringify(parts, Object.keys(parts).sort());
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function priceForOperation(
  operation: CommerceOperation,
  sourceFileCount?: number
): { amountMicro: string; priceLabel: string } {
  const price = resolveCommercePrice(operation, { sourceFileCount });
  return { amountMicro: price.amountMicro, priceLabel: price.priceLabel };
}

export async function createBoundQuote(input: {
  repository: string;
  branch: string;
  commitSha: string;
  findingIds: string[];
  operation: CommerceOperation;
  verificationProfile?: VerificationProfile;
  sourceFileCount?: number;
  idempotencyKey?: string;
}): Promise<BoundQuote> {
  const quoteId = `quote_${nanoid(12)}`;
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString();
  const { amountMicro, priceLabel } = priceForOperation(input.operation, input.sourceFileCount);
  const findingIds = [...input.findingIds].sort();

  const hashInput = {
    operation: input.operation,
    repository: input.repository,
    branch: input.branch,
    commitSha: input.commitSha,
    findingIds,
    verificationProfile: input.verificationProfile ?? "standard",
    amountMicro,
    currency: X402_CURRENCY,
    network: X402_NETWORK,
    recipient: X402_RECIPIENT,
    nonce,
    expiresAt,
  };

  const reqHash = requestHash(hashInput);
  const bindingHash = requestHash({ ...hashInput, requestHash: reqHash });

  const quote: BoundQuote = {
    quoteId,
    operation: input.operation,
    repository: input.repository,
    branch: input.branch,
    commitSha: input.commitSha,
    findingIds,
    verificationProfile: input.verificationProfile ?? "standard",
    amount: microToAmount(amountMicro),
    amountMicro,
    currency: X402_CURRENCY,
    network: X402_NETWORK,
    recipient: X402_RECIPIENT,
    asset: X402_ASSET,
    nonce,
    expiresAt,
    requestHash: reqHash,
    bindingHash,
    priceLabel,
    status: amountMicro === "0" ? "funded" : "payment_required",
    lifecycleStatus: amountMicro === "0" ? "funded" : "quote_created",
    createdAt: new Date().toISOString(),
    idempotencyKey: input.idempotencyKey,
  };

  if (amountMicro !== "0") {
    quote.lifecycleStatus = "payment_required";
  }

  await saveBoundQuote(quote);
  return quote;
}

export function quoteTo402Response(quote: BoundQuote, resourceUrl: string) {
  return {
    success: false,
    paymentRequired: true,
    quote,
    lifecycleStatus: quote.lifecycleStatus,
    ...paymentRequiredBody(resourceUrl, quote.amountMicro, quote.quoteId),
  };
}

export function validateQuoteBinding(
  quote: BoundQuote,
  context: {
    repository: string;
    branch: string;
    commitSha: string;
    findingIds: string[];
    operation: CommerceOperation;
  }
): { ok: boolean; reason?: string; status?: BoundQuote["lifecycleStatus"] } {
  if (new Date(quote.expiresAt).getTime() < Date.now()) {
    return { ok: false, reason: "Quote expired.", status: "expired" };
  }
  if (quote.status === "consumed") {
    return { ok: false, reason: "Quote already consumed.", status: "replayed" };
  }
  if (quote.repository !== context.repository) {
    return { ok: false, reason: "Repository mismatch.", status: "invalid_payment" };
  }
  if (quote.branch !== context.branch) {
    return { ok: false, reason: "Branch mismatch.", status: "invalid_payment" };
  }
  if (quote.commitSha !== context.commitSha) {
    return { ok: false, reason: "Commit SHA mismatch.", status: "invalid_payment" };
  }
  if (quote.operation !== context.operation) {
    return { ok: false, reason: "Operation mismatch.", status: "invalid_payment" };
  }
  const a = [...quote.findingIds].sort().join(",");
  const b = [...context.findingIds].sort().join(",");
  if (a !== b) {
    return { ok: false, reason: "Finding IDs mismatch.", status: "invalid_payment" };
  }
  return { ok: true };
}

export function signTestPaymentPayload(payload: Record<string, unknown>): string | null {
  const secret = process.env.REPODIET_X402_TEST_SECRET;
  if (!secret) return null;
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

export function verifyTestPaymentPayload(
  payload: Record<string, unknown>,
  signature: string
): boolean {
  const expected = signTestPaymentPayload(payload);
  return Boolean(expected && expected === signature);
}
