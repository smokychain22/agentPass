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
import { getBoundQuote, saveBoundQuote, updateBoundQuote } from "./payment-store";
import type { BoundQuote, VerificationProfile } from "./types";
import { paymentRequiredBody } from "./x402";
import {
  getPaymentEnvironment,
  MAINNET_NETWORK,
  MAINNET_USDT,
} from "./payment-environment";

function microToAmount(micro: string): string {
  const n = Number(micro);
  return (n / 1_000_000).toFixed(2);
}

function requestHash(parts: Record<string, string | string[]>): string {
  const canonical = JSON.stringify(parts, Object.keys(parts).sort());
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function hashTransformedSourceHashes(hashes?: Record<string, string>): string {
  if (!hashes || Object.keys(hashes).length === 0) return "";
  return JSON.stringify(Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b))));
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
  scanId?: string;
  transformedSourceHashes?: Record<string, string>;
  contractDigest?: string;
}): Promise<BoundQuote> {
  const paymentEnv = getPaymentEnvironment();
  if (paymentEnv.mainnetBlocked) {
    throw new Error(paymentEnv.blockReason || "MAINNET_CONFIGURATION_DETECTED");
  }

  // Prefer explicit payment-environment resolution when mode is set so Preview
  // testnet canaries never bind mainnet material from stale module defaults.
  const network =
    paymentEnv.paymentMode === "testnet" || paymentEnv.paymentMode === "mainnet"
      ? paymentEnv.network
      : X402_NETWORK;
  const asset =
    paymentEnv.paymentMode === "testnet" || paymentEnv.paymentMode === "mainnet"
      ? paymentEnv.asset
      : X402_ASSET;
  const recipient =
    paymentEnv.paymentMode === "testnet" || paymentEnv.paymentMode === "mainnet"
      ? paymentEnv.sellerWallet
      : X402_RECIPIENT;
  const chainId =
    paymentEnv.paymentMode === "testnet" || paymentEnv.paymentMode === "mainnet"
      ? paymentEnv.chainId
      : Number(String(network).split(":")[1] || "") || null;
  const environment =
    paymentEnv.paymentMode === "unset"
      ? network === MAINNET_NETWORK || asset === MAINNET_USDT
        ? "mainnet"
        : paymentEnv.environment
      : paymentEnv.environment;

  if (paymentEnv.paymentMode === "testnet" && (network === MAINNET_NETWORK || asset === MAINNET_USDT)) {
    throw new Error(
      "MAINNET_CONFIGURATION_DETECTED: testnet mode cannot issue mainnet quotes. NO_TRANSACTION_SENT."
    );
  }

  const quoteId = `quote_${nanoid(12)}`;
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString();
  const { amountMicro, priceLabel } = priceForOperation(input.operation, input.sourceFileCount);
  const findingIds = [...input.findingIds].sort();
  const transformedSourceHashes = input.transformedSourceHashes
    ? Object.fromEntries(
        Object.entries(input.transformedSourceHashes).sort(([a], [b]) => a.localeCompare(b))
      )
    : undefined;

  const hashInput = {
    operation: input.operation,
    repository: input.repository,
    branch: input.branch,
    commitSha: input.commitSha,
    findingIds,
    scanId: input.scanId ?? "",
    transformedSourceHashes: hashTransformedSourceHashes(transformedSourceHashes),
    verificationProfile: input.verificationProfile ?? "standard",
    contractDigest: input.contractDigest ?? "",
    amountMicro,
    currency: X402_CURRENCY,
    network,
    recipient,
    nonce,
    expiresAt,
    environment,
    paymentMode: paymentEnv.paymentMode,
    chainId: String(chainId ?? ""),
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
    network,
    recipient,
    asset,
    nonce,
    expiresAt,
    requestHash: reqHash,
    bindingHash,
    priceLabel,
    status: amountMicro === "0" ? "funded" : "payment_required",
    lifecycleStatus: amountMicro === "0" ? "funded" : "quote_created",
    createdAt: new Date().toISOString(),
    environment,
    paymentMode: paymentEnv.paymentMode,
    chainId,
    idempotencyKey: input.idempotencyKey,
    scanId: input.scanId,
    transformedSourceHashes,
    contractDigest: input.contractDigest,
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
    scanId?: string;
    transformedSourceHashes?: Record<string, string>;
    contractDigest?: string;
  }
): { ok: boolean; reason?: string; status?: BoundQuote["lifecycleStatus"] } {
  if (new Date(quote.expiresAt).getTime() < Date.now()) {
    return { ok: false, reason: "Quote expired.", status: "expired" };
  }
  if (quote.status === "consumed" && quote.completedReceiptId) {
    return { ok: false, reason: "Quote already consumed.", status: "replayed" };
  }
  if (quote.status === "consumed" && !quote.completedReceiptId && quote.paymentStatus === "verified") {
    // Mis-consumed without delivery — entitlement repair allows retry without new payment.
    return { ok: true };
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
  if (context.scanId && quote.scanId && quote.scanId !== context.scanId) {
    return { ok: false, reason: "Scan ID mismatch.", status: "invalid_payment" };
  }
  if (quote.transformedSourceHashes && context.transformedSourceHashes) {
    const qa = JSON.stringify(
      Object.fromEntries(Object.entries(quote.transformedSourceHashes).sort())
    );
    const qb = JSON.stringify(
      Object.fromEntries(Object.entries(context.transformedSourceHashes).sort())
    );
    if (qa !== qb) {
      return { ok: false, reason: "Transformed source hash mismatch.", status: "invalid_payment" };
    }
  }
  if (quote.contractDigest && quote.contractDigest !== context.contractDigest) {
    return { ok: false, reason: "Maintenance contract digest mismatch.", status: "invalid_payment" };
  }
  return { ok: true };
}

export async function bindQuoteToMaintenanceContract(
  quoteId: string,
  contractDigest: string
): Promise<BoundQuote> {
  const quote = await getBoundQuote(quoteId);
  if (!quote) throw new Error("contract_quote_not_found");
  if (new Date(quote.expiresAt).getTime() <= Date.now()) {
    throw new Error("contract_quote_expired");
  }
  if (quote.status === "consumed" || quote.lifecycleStatus === "execution_started" ||
      quote.lifecycleStatus === "completed" || quote.paymentStatus === "verified") {
    throw new Error("contract_quote_already_used");
  }
  if (quote.contractDigest && quote.contractDigest !== contractDigest) {
    throw new Error("contract_quote_digest_conflict");
  }
  const hashInput = {
    operation: quote.operation,
    repository: quote.repository,
    branch: quote.branch,
    commitSha: quote.commitSha,
    findingIds: [...quote.findingIds].sort(),
    scanId: quote.scanId ?? "",
    transformedSourceHashes: hashTransformedSourceHashes(quote.transformedSourceHashes),
    verificationProfile: quote.verificationProfile,
    contractDigest,
    amountMicro: quote.amountMicro,
    currency: quote.currency,
    network: quote.network,
    recipient: quote.recipient,
    nonce: quote.nonce,
    expiresAt: quote.expiresAt,
  };
  const requestHashValue = requestHash(hashInput);
  const bindingHash = requestHash({ ...hashInput, requestHash: requestHashValue });
  const updated = await updateBoundQuote(quoteId, {
    contractDigest,
    requestHash: requestHashValue,
    bindingHash,
  });
  if (!updated) throw new Error("contract_quote_bind_failed");
  return updated;
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
