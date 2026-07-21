import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { CommerceBinding } from "@/lib/okx/types";
import type { BoundQuote } from "./types";
import {
  deleteDurableRecord,
  getDurableRecord,
  setDurableRecord,
  setDurableRecordIfAbsentWithTtl,
} from "@/lib/store/durable-store";
import {
  newPaymentRecord,
  persistQuoteLifecycle,
  savePaymentRecord,
} from "./payment-store";
import { validateQuoteBinding } from "./quote-service";
import {
  MAINNET_NETWORK,
  MAINNET_USDT,
} from "./payment-environment";
import { QUICK_TRIAGE_AMOUNT } from "./x402-config-validation";
import { isRedisPersistenceEnabled } from "@/lib/server/runtime-env";

type JsonRecord = Record<string, unknown>;

export interface X402Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface X402PaymentPayloadV2 {
  x402Version: number;
  resource: { url: string; description?: string; mimeType?: string };
  accepted: {
    scheme: string;
    network: string;
    asset: string;
    amount: string;
    payTo: string;
    maxTimeoutSeconds?: number;
    extra?: JsonRecord;
  };
  payload: {
    signature: string;
    authorization: X402Authorization;
  };
}

export interface X402SettlementEvidence {
  success: true;
  transaction: string;
  network: string;
  payer: string;
  status: "success";
  amount: string;
  paymentResponseHeader: string;
}

interface AuthorizationRecord {
  quoteId: string;
  requestHash: string;
  credentialDigest: string;
  state: "verifying" | "settled";
  expiresAt: string;
  settlement?: X402SettlementEvidence;
}

interface OkxEnvelope<T> {
  code?: string;
  msg?: string;
  data?: T;
}

interface VerifyData {
  isValid?: boolean;
  invalidReason?: string | null;
  invalidMessage?: string | null;
  payer?: string;
}

interface SettleData {
  success?: boolean;
  errorReason?: string | null;
  errorMessage?: string | null;
  payer?: string;
  transaction?: string;
  network?: string;
  status?: string;
}

export class A2mcpX402Error extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "A2mcpX402Error";
    this.code = code;
    this.retryable = retryable;
  }
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new A2mcpX402Error("INVALID_PAYMENT", `${label} must be an object.`);
  }
  return value as JsonRecord;
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new A2mcpX402Error("INVALID_PAYMENT", `${label} is missing.`);
  }
  return value.trim();
}

function decodeBase64Json(value: string): unknown {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

export function decodePaymentSignatureHeader(header: string): X402PaymentPayloadV2 {
  try {
    const root = record(decodeBase64Json(header), "PAYMENT-SIGNATURE");
    const accepted = record(root.accepted, "accepted");
    const resource = record(root.resource, "resource");
    const payload = record(root.payload, "payload");
    const authorization = record(payload.authorization, "authorization");
    return {
      x402Version: Number(root.x402Version),
      resource: {
        url: stringField(resource.url, "resource.url"),
        description: typeof resource.description === "string" ? resource.description : undefined,
        mimeType: typeof resource.mimeType === "string" ? resource.mimeType : undefined,
      },
      accepted: {
        scheme: stringField(accepted.scheme, "accepted.scheme"),
        network: stringField(accepted.network, "accepted.network"),
        asset: stringField(accepted.asset, "accepted.asset"),
        amount: stringField(accepted.amount, "accepted.amount"),
        payTo: stringField(accepted.payTo, "accepted.payTo"),
        maxTimeoutSeconds:
          accepted.maxTimeoutSeconds == null ? undefined : Number(accepted.maxTimeoutSeconds),
        extra: accepted.extra && typeof accepted.extra === "object"
          ? (accepted.extra as JsonRecord)
          : undefined,
      },
      payload: {
        signature: stringField(payload.signature, "payload.signature"),
        authorization: {
          from: stringField(authorization.from, "authorization.from"),
          to: stringField(authorization.to, "authorization.to"),
          value: stringField(authorization.value, "authorization.value"),
          validAfter: stringField(authorization.validAfter, "authorization.validAfter"),
          validBefore: stringField(authorization.validBefore, "authorization.validBefore"),
          nonce: stringField(authorization.nonce, "authorization.nonce"),
        },
      },
    };
  } catch (error) {
    if (error instanceof A2mcpX402Error) throw error;
    throw new A2mcpX402Error("INVALID_PAYMENT", "PAYMENT-SIGNATURE is not valid base64 JSON.");
  }
}

export function quoteIdFromPaymentPayload(payload: X402PaymentPayloadV2): string | undefined {
  const quoteId = payload.accepted.extra?.quoteId;
  return typeof quoteId === "string" && quoteId.trim() ? quoteId.trim() : undefined;
}

function equalAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function assertEqual(actual: string, expected: string, label: string): void {
  const a = Buffer.from(actual.toLowerCase());
  const b = Buffer.from(expected.toLowerCase());
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new A2mcpX402Error("PAYMENT_MISMATCH", `${label} does not match the issued challenge.`);
  }
}

export function validatePaymentPayloadForRequest(input: {
  payload: X402PaymentPayloadV2;
  quote: BoundQuote;
  binding: CommerceBinding;
  nowSeconds?: number;
}): X402Authorization {
  const { payload, quote, binding } = input;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (payload.x402Version !== 2) {
    throw new A2mcpX402Error("INVALID_PAYMENT", "Only x402Version 2 is accepted.");
  }
  if (payload.accepted.scheme !== "exact") {
    throw new A2mcpX402Error("INVALID_PAYMENT", "Only the exact payment scheme is accepted.");
  }
  if (payload.accepted.maxTimeoutSeconds !== 300) {
    throw new A2mcpX402Error("PAYMENT_MISMATCH", "payment timeout does not match the issued challenge.");
  }
  if (new Date(quote.expiresAt).getTime() <= now * 1000) {
    throw new A2mcpX402Error("EXPIRED_QUOTE", "Payment quote has expired.");
  }
  assertEqual(payload.accepted.network, MAINNET_NETWORK, "network");
  assertEqual(payload.accepted.network, quote.network, "network");
  assertEqual(payload.accepted.asset, MAINNET_USDT, "asset");
  assertEqual(payload.accepted.asset, quote.asset, "asset");
  assertEqual(payload.accepted.amount, QUICK_TRIAGE_AMOUNT, "amount");
  assertEqual(payload.accepted.amount, quote.amountMicro, "amount");
  if (!equalAddress(payload.accepted.payTo, quote.recipient)) {
    throw new A2mcpX402Error("PAYMENT_MISMATCH", "recipient does not match the issued challenge.");
  }
  if (!quote.resourceUrl || payload.resource.url !== quote.resourceUrl) {
    throw new A2mcpX402Error("PAYMENT_MISMATCH", "resource does not match the issued challenge.");
  }
  if (quoteIdFromPaymentPayload(payload) !== quote.quoteId) {
    throw new A2mcpX402Error("PAYMENT_MISMATCH", "quote identifier does not match the issued challenge.");
  }

  const bindingCheck = validateQuoteBinding(quote, {
    repository: binding.repository,
    branch: binding.branch,
    commitSha: binding.commitSha,
    findingIds: binding.findingIds,
    operation: binding.operation,
    requestHash: binding.requestHash,
    resourceUrl: binding.resourceUrl,
    requestMethod: binding.requestMethod,
    requestPayloadHash: binding.requestPayloadHash,
  });
  if (!bindingCheck.ok) {
    throw new A2mcpX402Error("REQUEST_MISMATCH", bindingCheck.reason ?? "Request binding mismatch.");
  }

  const authorization = payload.payload.authorization;
  if (!/^0x[a-fA-F0-9]{40}$/.test(authorization.from)) {
    throw new A2mcpX402Error("INVALID_PAYMENT", "payer address is invalid.");
  }
  if (!equalAddress(authorization.to, quote.recipient)) {
    throw new A2mcpX402Error("PAYMENT_MISMATCH", "authorization recipient mismatch.");
  }
  if (authorization.value !== quote.amountMicro) {
    throw new A2mcpX402Error("PAYMENT_MISMATCH", "authorization amount mismatch.");
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(authorization.nonce)) {
    throw new A2mcpX402Error("INVALID_PAYMENT", "authorization nonce is invalid.");
  }
  if (!/^0x[a-fA-F0-9]+$/.test(payload.payload.signature)) {
    throw new A2mcpX402Error("INVALID_PAYMENT", "payment signature is malformed.");
  }
  const validAfter = Number(authorization.validAfter);
  const validBefore = Number(authorization.validBefore);
  if (!Number.isFinite(validAfter) || !Number.isFinite(validBefore) || validBefore <= validAfter) {
    throw new A2mcpX402Error("INVALID_PAYMENT", "authorization validity window is invalid.");
  }
  if (validAfter > now) {
    throw new A2mcpX402Error("NOT_YET_VALID", "payment authorization is not yet valid.");
  }
  if (validBefore <= now) {
    throw new A2mcpX402Error("EXPIRED_AUTHORIZATION", "payment authorization has expired.");
  }
  const maxWindow = payload.accepted.maxTimeoutSeconds ?? 300;
  if (validBefore > now + maxWindow + 30) {
    throw new A2mcpX402Error("INVALID_PAYMENT", "authorization exceeds the challenge validity window.");
  }
  return authorization;
}

export function paymentRequirementsFromQuote(quote: BoundQuote): JsonRecord {
  return {
    scheme: "exact",
    network: quote.network,
    amount: quote.amountMicro,
    asset: quote.asset,
    payTo: quote.recipient,
    maxTimeoutSeconds: 300,
    extra: { name: "USD₮0", version: "1", quoteId: quote.quoteId },
  };
}

function encodePaymentResponse(evidence: Omit<X402SettlementEvidence, "paymentResponseHeader">): string {
  return Buffer.from(JSON.stringify(evidence), "utf8").toString("base64");
}

function credentialDigest(payload: X402PaymentPayloadV2): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function authorizationKey(payload: X402PaymentPayloadV2): string {
  const auth = payload.payload.authorization;
  return `a2mcp_x402_auth_${createHash("sha256")
    .update(`${payload.accepted.network}:${payload.accepted.asset.toLowerCase()}:${auth.from.toLowerCase()}:${auth.nonce}`)
    .digest("hex")}`;
}

async function persistConfirmedSettlement(input: {
  quote: BoundQuote;
  authorization: X402Authorization;
  evidence: X402SettlementEvidence;
  credentialDigest: string;
}): Promise<void> {
  await persistQuoteLifecycle(input.quote.quoteId, "funded", {
    paymentReference: input.evidence.transaction,
    payer: input.evidence.payer,
    paymentStatus: "verified",
    fundedAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
    settlementResponseHeader: input.evidence.paymentResponseHeader,
  });
  await savePaymentRecord(
    newPaymentRecord({
      quoteId: input.quote.quoteId,
      paymentReference: input.evidence.transaction,
      payer: input.evidence.payer,
      amountMicro: input.quote.amountMicro,
      nonce: input.authorization.nonce,
      idempotencyKey: `x402_${input.credentialDigest}`,
      lifecycleStatus: "funded",
    })
  );
}

function facilitatorConfig(env: NodeJS.ProcessEnv = process.env) {
  const apiKey = env.OKX_API_KEY?.trim();
  const secretKey = env.OKX_SECRET_KEY?.trim();
  const passphrase = env.OKX_PASSPHRASE?.trim();
  if (!apiKey || !secretKey || !passphrase) {
    throw new A2mcpX402Error(
      "FACILITATOR_NOT_CONFIGURED",
      "OKX payment verification is not configured.",
      true
    );
  }
  return {
    apiKey,
    secretKey,
    passphrase,
    baseUrl: (env.REPODIET_X402_FACILITATOR_URL?.trim() || "https://web3.okx.com").replace(/\/$/, ""),
  };
}

export interface X402Broker {
  verify(paymentPayload: X402PaymentPayloadV2, paymentRequirements: JsonRecord): Promise<VerifyData>;
  settle(paymentPayload: X402PaymentPayloadV2, paymentRequirements: JsonRecord): Promise<SettleData>;
  settlementStatus?(transaction: string): Promise<SettleData>;
}

export class OkxX402Broker implements X402Broker {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  private async request<T>(method: "GET" | "POST", path: string, body?: JsonRecord): Promise<T> {
    const config = facilitatorConfig(this.env);
    const timestamp = new Date().toISOString();
    const bodyText = body ? JSON.stringify(body) : "";
    const signature = createHmac("sha256", config.secretKey)
      .update(`${timestamp}${method}${path}${bodyText}`)
      .digest("base64");
    let response: Response;
    try {
      response = await this.fetchImpl(`${config.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "OK-ACCESS-KEY": config.apiKey,
          "OK-ACCESS-SIGN": signature,
          "OK-ACCESS-PASSPHRASE": config.passphrase,
          "OK-ACCESS-TIMESTAMP": timestamp,
        },
        body: bodyText || undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new A2mcpX402Error("FACILITATOR_UNAVAILABLE", "OKX payment service is unavailable.", true);
    }
    let envelope: OkxEnvelope<T>;
    try {
      envelope = (await response.json()) as OkxEnvelope<T>;
    } catch {
      throw new A2mcpX402Error("FACILITATOR_ERROR", "OKX payment service returned an invalid response.", true);
    }
    if (!response.ok || envelope.code !== "0" || !envelope.data) {
      throw new A2mcpX402Error(
        "FACILITATOR_REJECTED",
        "OKX payment service rejected the request.",
        response.status >= 500
      );
    }
    return envelope.data;
  }

  verify(paymentPayload: X402PaymentPayloadV2, paymentRequirements: JsonRecord): Promise<VerifyData> {
    return this.request("POST", "/api/v6/pay/x402/verify", {
      x402Version: 2,
      paymentPayload,
      paymentRequirements,
    });
  }

  settle(paymentPayload: X402PaymentPayloadV2, paymentRequirements: JsonRecord): Promise<SettleData> {
    return this.request("POST", "/api/v6/pay/x402/settle", {
      x402Version: 2,
      paymentPayload,
      paymentRequirements,
      syncSettle: true,
    });
  }

  settlementStatus(transaction: string): Promise<SettleData> {
    const query = `/api/v6/pay/x402/settle/status?txHash=${encodeURIComponent(transaction)}`;
    return this.request("GET", query);
  }
}

async function waitForConfirmedSettlement(
  broker: X402Broker,
  initial: SettleData
): Promise<SettleData> {
  if (initial.success === true && initial.status === "success") return initial;
  if (initial.success !== true || initial.status !== "timeout" || !initial.transaction || !broker.settlementStatus) {
    return initial;
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    const current = await broker.settlementStatus(initial.transaction);
    if (current.status === "success" || current.status === "failed") return current;
  }
  return initial;
}

export async function verifyAndSettleA2mcpPayment(input: {
  payload: X402PaymentPayloadV2;
  quote: BoundQuote;
  binding: CommerceBinding;
  broker?: X402Broker;
  nowSeconds?: number;
}): Promise<X402SettlementEvidence> {
  if (
    (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") &&
    !isRedisPersistenceEnabled()
  ) {
    throw new A2mcpX402Error(
      "DURABLE_PAYMENT_STORE_REQUIRED",
      "Durable payment storage is not configured.",
      true
    );
  }
  const authorization = validatePaymentPayloadForRequest(input);
  const digest = credentialDigest(input.payload);
  const key = authorizationKey(input.payload);
  const existing = await getDurableRecord<AuthorizationRecord>("payment_entitlements", key);
  if (existing?.state === "settled" && existing.settlement) {
    if (
      existing.quoteId === input.quote.quoteId &&
      existing.requestHash === input.binding.requestHash &&
      existing.credentialDigest === digest
    ) {
      await persistConfirmedSettlement({
        quote: input.quote,
        authorization,
        evidence: existing.settlement,
        credentialDigest: digest,
      });
      return existing.settlement;
    }
    throw new A2mcpX402Error("REPLAYED_AUTHORIZATION", "Payment authorization was already used.");
  }
  if (existing?.state === "verifying" && new Date(existing.expiresAt).getTime() > Date.now()) {
    throw new A2mcpX402Error("PAYMENT_IN_PROGRESS", "Payment verification is already in progress.", true);
  }
  if (existing) await deleteDurableRecord("payment_entitlements", key);

  const reservation: AuthorizationRecord = {
    quoteId: input.quote.quoteId,
    requestHash: input.binding.requestHash,
    credentialDigest: digest,
    state: "verifying",
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
  const claimed = await setDurableRecordIfAbsentWithTtl(
    "payment_entitlements",
    key,
    reservation,
    10 * 60
  );
  if (!claimed) {
    throw new A2mcpX402Error("PAYMENT_IN_PROGRESS", "Payment verification is already in progress.", true);
  }

  let settlementConfirmed = false;
  try {
    const requirements = paymentRequirementsFromQuote(input.quote);
    const broker = input.broker ?? new OkxX402Broker();
    const verified = await broker.verify(input.payload, requirements);
    if (verified.isValid !== true) {
      throw new A2mcpX402Error(
        "INVALID_PAYMENT",
        "Payment verification failed."
      );
    }
    if (verified.payer && !equalAddress(verified.payer, authorization.from)) {
      throw new A2mcpX402Error("PAYMENT_MISMATCH", "Verified payer does not match authorization.");
    }

    const settled = await waitForConfirmedSettlement(
      broker,
      await broker.settle(input.payload, requirements)
    );
    if (
      settled.success !== true ||
      settled.status !== "success" ||
      !settled.transaction ||
      settled.network !== MAINNET_NETWORK
    ) {
      throw new A2mcpX402Error(
        "SETTLEMENT_FAILED",
        "Payment settlement was not confirmed.",
        settled.status === "timeout"
      );
    }
    const payer = settled.payer || verified.payer || authorization.from;
    if (!equalAddress(payer, authorization.from)) {
      throw new A2mcpX402Error("PAYMENT_MISMATCH", "Settled payer does not match authorization.");
    }
    const responseFields = {
      success: true as const,
      transaction: settled.transaction,
      network: MAINNET_NETWORK,
      payer,
      status: "success" as const,
      amount: input.quote.amountMicro,
    };
    const evidence: X402SettlementEvidence = {
      ...responseFields,
      paymentResponseHeader: encodePaymentResponse(responseFields),
    };
    await setDurableRecord("payment_entitlements", key, {
      ...reservation,
      state: "settled",
      settlement: evidence,
    } satisfies AuthorizationRecord);
    settlementConfirmed = true;
    await persistConfirmedSettlement({
      quote: input.quote,
      authorization,
      evidence,
      credentialDigest: digest,
    });
    return evidence;
  } catch (error) {
    if (!settlementConfirmed) {
      await deleteDurableRecord("payment_entitlements", key).catch(() => undefined);
    }
    throw error;
  }
}
