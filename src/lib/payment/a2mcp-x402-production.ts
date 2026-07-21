import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
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

export interface VerifyData {
  isValid?: boolean;
  invalidReason?: string | null;
  invalidMessage?: string | null;
  payer?: string;
}

export interface SettleData {
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
  readonly correlationId?: string;

  constructor(code: string, message: string, retryable = false, correlationId?: string) {
    super(message);
    this.name = "A2mcpX402Error";
    this.code = code;
    this.retryable = retryable;
    this.correlationId = correlationId;
  }
}

export interface FacilitatorDiagnostic {
  event: "repodiet.x402.facilitator";
  phase: "verify" | "settle" | "settlement_status";
  correlationId: string;
  paymentAttemptId: string;
  timestamp: string;
  path: string;
  httpStatus?: number;
  okxCode?: string;
  okxMessage?: string;
  isValid?: boolean;
  invalidReason?: string | null;
  invalidMessage?: string | null;
  payer?: string;
  settlementSuccess?: boolean;
  settlementStatus?: string;
  settlementErrorReason?: string | null;
  settlementErrorMessage?: string | null;
  x402Version?: number;
  scheme?: string;
  network?: string;
  asset?: string;
  amount?: string;
  recipient?: string;
  validAfter?: string;
  validBefore?: string;
  requestShape?: JsonRecord;
  responseShape?: JsonRecord;
}

function jsonRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function normalizeFacilitatorEnvelope<T>(value: unknown): {
  code?: string;
  msg?: string;
  data?: T;
  responseShape: JsonRecord;
} {
  const envelope = jsonRecord(value);
  const rawData = envelope?.data;
  const dataArray = Array.isArray(rawData) ? rawData : undefined;
  const selected = dataArray ? dataArray[0] : rawData;
  const selectedRecord = jsonRecord(selected);
  const normalizedData = selectedRecord ? { ...selectedRecord } : undefined;

  // Some facilitator envelopes expose safe rejection details beside `data`.
  // Preserve them without treating their absence as an explicit rejection.
  if (normalizedData) {
    for (const field of ["invalidReason", "invalidMessage"] as const) {
      if (normalizedData[field] == null && typeof envelope?.[field] === "string") {
        normalizedData[field] = envelope[field];
      }
    }
  }

  return {
    code: typeof envelope?.code === "string" || typeof envelope?.code === "number"
      ? String(envelope.code)
      : undefined,
    msg: typeof envelope?.msg === "string" ? envelope.msg : undefined,
    data: normalizedData as T | undefined,
    responseShape: {
      envelopeType: envelope ? "object" : Array.isArray(value) ? "array" : typeof value,
      codeType: typeof envelope?.code,
      dataType: dataArray ? "array" : rawData === null ? "null" : typeof rawData,
      dataLength: dataArray?.length,
      selectedDataType: selected === null ? "null" : typeof selected,
      isValidPresent: selectedRecord ? Object.prototype.hasOwnProperty.call(selectedRecord, "isValid") : false,
      isValidType: typeof selectedRecord?.isValid,
      invalidReasonPresent: Boolean(
        (selectedRecord && Object.prototype.hasOwnProperty.call(selectedRecord, "invalidReason")) ||
        (envelope && Object.prototype.hasOwnProperty.call(envelope, "invalidReason"))
      ),
      invalidMessagePresent: Boolean(
        (selectedRecord && Object.prototype.hasOwnProperty.call(selectedRecord, "invalidMessage")) ||
        (envelope && Object.prototype.hasOwnProperty.call(envelope, "invalidMessage"))
      ),
    },
  };
}

export type FacilitatorDiagnosticSink = (diagnostic: FacilitatorDiagnostic) => void;

const SECRET_VALUE_PATTERN = /\b(okx[-_ ]?(?:api[-_ ]?key|secret|passphrase)|ok[-_ ]access[-_ ]key|api[-_ ]?key|secret|passphrase|private[-_ ]?key|github[-_ ]?token|session[-_ ]?secret)\b\s*[:=]?\s*["']?[A-Za-z0-9_./+-]{4,}["']?/gi;

function safeBrokerText(value: unknown, secrets: string[] = []): string | null | undefined {
  if (value == null) return value as null | undefined;
  let text = String(value)
    .replace(SECRET_VALUE_PATTERN, "$1 [redacted]")
    .replace(/0x[a-fA-F0-9]{80,}/g, "[redacted-hex]")
    .replace(/(?:gh[opusr]_|Bearer\s+)[A-Za-z0-9._-]+/gi, "[redacted-token]");
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join("[redacted]");
  }
  return text.slice(0, 240);
}

/** Redacts and bounds facilitator text before a diagnostic response leaves the server. */
export function redactX402DiagnosticText(value: unknown): string {
  return safeBrokerText(value) ?? "";
}

function redactAddress(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) return undefined;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function defaultDiagnosticSink(diagnostic: FacilitatorDiagnostic): void {
  console.error(JSON.stringify(diagnostic));
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new A2mcpX402Error("PAYMENT_PAYLOAD_INVALID", `${label} must be an object.`);
  }
  return value as JsonRecord;
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new A2mcpX402Error("PAYMENT_PAYLOAD_INVALID", `${label} is missing.`);
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
    if (Number(root.x402Version) !== 2) {
      throw new A2mcpX402Error("PAYMENT_PAYLOAD_INVALID", "Only x402Version 2 is accepted.");
    }
    if (Array.isArray(root.accepts)) {
      throw new A2mcpX402Error(
        "PAYMENT_PAYLOAD_INVALID",
        "Choose one payment option in accepted; accepts[] is not a paid payload."
      );
    }
    const accepted = record(root.accepted, "accepted");
    const resource = record(root.resource, "resource");
    const payload = record(root.payload, "payload");
    if (payload.permit2Authorization != null) {
      throw new A2mcpX402Error(
        "PAYMENT_PAYLOAD_INVALID",
        "The exact EIP-3009 service accepts authorization only."
      );
    }
    const authorization = record(payload.authorization, "authorization");
    return {
      x402Version: 2,
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
    throw new A2mcpX402Error("PAYMENT_PAYLOAD_INVALID", "PAYMENT-SIGNATURE is not valid base64 JSON.");
  }
}

export function quoteIdFromPaymentPayload(payload: X402PaymentPayloadV2): string | undefined {
  const quoteId = payload.accepted.extra?.quoteId;
  return typeof quoteId === "string" && quoteId.trim() ? quoteId.trim() : undefined;
}

function equalAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function assertEqual(actual: string, expected: string, label: string, code: string): void {
  const a = Buffer.from(actual.toLowerCase());
  const b = Buffer.from(expected.toLowerCase());
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new A2mcpX402Error(code, `${label} does not match the issued challenge.`);
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
    throw new A2mcpX402Error("PAYMENT_REQUIREMENTS_MISMATCH", "Only the exact payment scheme is accepted.");
  }
  if (payload.accepted.maxTimeoutSeconds !== 300) {
    throw new A2mcpX402Error("PAYMENT_REQUIREMENTS_MISMATCH", "payment timeout does not match the issued challenge.");
  }
  if (new Date(quote.expiresAt).getTime() <= now * 1000) {
    throw new A2mcpX402Error("EXPIRED_QUOTE", "Payment quote has expired.");
  }
  assertEqual(payload.accepted.network, MAINNET_NETWORK, "network", "PAYMENT_NETWORK_MISMATCH");
  assertEqual(payload.accepted.network, quote.network, "network", "PAYMENT_NETWORK_MISMATCH");
  assertEqual(payload.accepted.asset, MAINNET_USDT, "asset", "PAYMENT_ASSET_MISMATCH");
  assertEqual(payload.accepted.asset, quote.asset, "asset", "PAYMENT_ASSET_MISMATCH");
  assertEqual(payload.accepted.amount, QUICK_TRIAGE_AMOUNT, "amount", "PAYMENT_AMOUNT_MISMATCH");
  assertEqual(payload.accepted.amount, quote.amountMicro, "amount", "PAYMENT_AMOUNT_MISMATCH");
  if (!equalAddress(payload.accepted.payTo, quote.recipient)) {
    throw new A2mcpX402Error("PAYMENT_RECIPIENT_MISMATCH", "recipient does not match the issued challenge.");
  }
  if (!quote.resourceUrl || payload.resource.url !== quote.resourceUrl) {
    throw new A2mcpX402Error("PAYMENT_REQUIREMENTS_MISMATCH", "resource does not match the issued challenge.");
  }
  if (quoteIdFromPaymentPayload(payload) !== quote.quoteId) {
    throw new A2mcpX402Error("PAYMENT_REQUIREMENTS_MISMATCH", "quote identifier does not match the issued challenge.");
  }
  if (payload.accepted.extra?.name !== "USD₮0" || payload.accepted.extra?.version !== "1") {
    throw new A2mcpX402Error("PAYMENT_REQUIREMENTS_MISMATCH", "token-domain metadata does not match the issued challenge.");
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
    throw new A2mcpX402Error("PAYMENT_PAYLOAD_INVALID", "payer address is invalid.");
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(authorization.to)) {
    throw new A2mcpX402Error("PAYMENT_PAYLOAD_INVALID", "authorization recipient is invalid.");
  }
  if (!equalAddress(authorization.to, quote.recipient)) {
    throw new A2mcpX402Error("PAYMENT_RECIPIENT_MISMATCH", "authorization recipient mismatch.");
  }
  if (authorization.value !== quote.amountMicro) {
    throw new A2mcpX402Error("PAYMENT_AMOUNT_MISMATCH", "authorization amount mismatch.");
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(authorization.nonce)) {
    throw new A2mcpX402Error("PAYMENT_PAYLOAD_INVALID", "authorization nonce is invalid.");
  }
  if (!/^0x[a-fA-F0-9]{130}$/.test(payload.payload.signature)) {
    throw new A2mcpX402Error("PAYMENT_SIGNATURE_INVALID", "payment signature is malformed.");
  }
  if (!/^\d+$/.test(authorization.validAfter) || !/^\d+$/.test(authorization.validBefore)) {
    throw new A2mcpX402Error("PAYMENT_PAYLOAD_INVALID", "authorization validity timestamps are invalid.");
  }
  const validAfter = Number(authorization.validAfter);
  const validBefore = Number(authorization.validBefore);
  if (!Number.isFinite(validAfter) || !Number.isFinite(validBefore) || validBefore <= validAfter) {
    throw new A2mcpX402Error("PAYMENT_PAYLOAD_INVALID", "authorization validity window is invalid.");
  }
  if (validAfter > now) {
    throw new A2mcpX402Error("NOT_YET_VALID", "payment authorization is not yet valid.");
  }
  if (validBefore <= now) {
    throw new A2mcpX402Error("PAYMENT_AUTHORIZATION_EXPIRED", "payment authorization has expired.");
  }
  const maxWindow = payload.accepted.maxTimeoutSeconds ?? 300;
  if (validBefore > now + maxWindow + 30) {
    throw new A2mcpX402Error("PAYMENT_PAYLOAD_INVALID", "authorization exceeds the challenge validity window.");
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

export function signFacilitatorRequest(input: {
  method: "GET" | "POST";
  path: string;
  timestamp: string;
  body?: JsonRecord;
  secretKey: string;
}): { bodyText: string; signature: string } {
  const bodyText = input.body ? JSON.stringify(input.body) : "";
  return {
    bodyText,
    signature: createHmac("sha256", input.secretKey)
      .update(`${input.timestamp}${input.method}${input.path}${bodyText}`)
      .digest("base64"),
  };
}

function facilitatorPhase(path: string): FacilitatorDiagnostic["phase"] {
  if (path.includes("/verify")) return "verify";
  if (path.includes("/settle/status")) return "settlement_status";
  return "settle";
}

function paymentAttemptId(body?: JsonRecord): string {
  const payload = body?.paymentPayload;
  return `payatt_${createHash("sha256").update(JSON.stringify(payload ?? body ?? {})).digest("hex").slice(0, 20)}`;
}

function brokerErrorCode(input: {
  phase: FacilitatorDiagnostic["phase"];
  httpStatus: number;
  okxCode?: string;
  message?: string | null;
}): string {
  const message = `${input.okxCode ?? ""} ${input.message ?? ""}`.toLowerCase();
  if (input.httpStatus === 401 || input.httpStatus === 403 || /(api.?key|passphrase|timestamp|access.?sign|credential|unauthori)/.test(message)) {
    return "FACILITATOR_AUTH_ERROR";
  }
  if (input.httpStatus >= 500 || input.httpStatus === 429) return "FACILITATOR_HTTP_ERROR";
  if (/signature/.test(message)) return "PAYMENT_SIGNATURE_INVALID";
  if (/expir|validbefore|validity/.test(message)) return "PAYMENT_AUTHORIZATION_EXPIRED";
  if (/network|chain/.test(message)) return "PAYMENT_NETWORK_MISMATCH";
  if (/asset|token/.test(message)) return "PAYMENT_ASSET_MISMATCH";
  if (/amount|value/.test(message)) return "PAYMENT_AMOUNT_MISMATCH";
  if (/recipient|payto|pay to|authorization\.to/.test(message)) return "PAYMENT_RECIPIENT_MISMATCH";
  if (/payload|format|parameter|invalid json/.test(message)) return "PAYMENT_PAYLOAD_INVALID";
  if (/requirement|mismatch|accepted/.test(message)) return "PAYMENT_REQUIREMENTS_MISMATCH";
  if (input.httpStatus < 200 || input.httpStatus >= 300) return "FACILITATOR_HTTP_ERROR";
  return input.phase === "verify" ? "PAYMENT_VERIFICATION_REJECTED" : "PAYMENT_SETTLEMENT_REJECTED";
}

function diagnosticContext(body: JsonRecord | undefined): Pick<FacilitatorDiagnostic,
  "x402Version" | "scheme" | "network" | "asset" | "amount" | "recipient" | "validAfter" | "validBefore" | "requestShape"
> {
  const paymentPayload = body?.paymentPayload as X402PaymentPayloadV2 | undefined;
  const requirements = body?.paymentRequirements as JsonRecord | undefined;
  const accepted = paymentPayload?.accepted;
  const authorization = paymentPayload?.payload?.authorization;
  const resourceUrl = paymentPayload?.resource?.url;
  const redactedShape: JsonRecord | undefined = paymentPayload && requirements ? {
    x402Version: body?.x402Version,
    paymentPayload: {
      x402Version: paymentPayload.x402Version,
      resource: { url: resourceUrl },
      accepted: {
        scheme: accepted?.scheme,
        network: accepted?.network,
        asset: accepted?.asset,
        amount: accepted?.amount,
        payTo: redactAddress(accepted?.payTo),
      },
      payload: {
        signature: "[redacted]",
        authorization: authorization ? {
          from: redactAddress(authorization.from),
          to: redactAddress(authorization.to),
          value: authorization.value,
          validAfter: authorization.validAfter,
          validBefore: authorization.validBefore,
          nonce: "[redacted]",
        } : undefined,
        permit2Authorization: (paymentPayload.payload as unknown as JsonRecord).permit2Authorization == null
          ? undefined
          : "[present-redacted]",
      },
    },
    paymentRequirements: {
      scheme: requirements.scheme,
      network: requirements.network,
      asset: requirements.asset,
      amount: requirements.amount,
      payTo: redactAddress(requirements.payTo),
    },
  } : undefined;
  return {
    x402Version: typeof body?.x402Version === "number" ? body.x402Version : undefined,
    scheme: typeof requirements?.scheme === "string" ? requirements.scheme : accepted?.scheme,
    network: typeof requirements?.network === "string" ? requirements.network : accepted?.network,
    asset: typeof requirements?.asset === "string" ? requirements.asset : accepted?.asset,
    amount: typeof requirements?.amount === "string" ? requirements.amount : accepted?.amount,
    recipient: redactAddress(typeof requirements?.payTo === "string" ? requirements.payTo : accepted?.payTo),
    validAfter: authorization?.validAfter,
    validBefore: authorization?.validBefore,
    requestShape: redactedShape,
  };
}

export interface OkxX402BrokerOptions {
  now?: () => Date;
  correlationId?: () => string;
  diagnosticSink?: FacilitatorDiagnosticSink;
}

export interface X402VerifyOnlyResult {
  data?: VerifyData;
  diagnostic: FacilitatorDiagnostic;
  internalCode: string;
}

export interface X402VerifyOnlyClient {
  verify(
    paymentPayload: X402PaymentPayloadV2,
    paymentRequirements: JsonRecord
  ): Promise<X402VerifyOnlyResult>;
}

/**
 * Exposes only facilitator verification. The returned frozen capability has no
 * settlement or settlement-status method, so diagnostic callers cannot redeem
 * an authorization even accidentally.
 */
export function createOkxX402VerifyOnlyClient(input: {
  correlationId: string;
  diagnosticSink?: FacilitatorDiagnosticSink;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}): X402VerifyOnlyClient {
  return Object.freeze({
    async verify(
      paymentPayload: X402PaymentPayloadV2,
      paymentRequirements: JsonRecord
    ) {
      let captured: FacilitatorDiagnostic | undefined;
      const sink: FacilitatorDiagnosticSink = (diagnostic) => {
        captured = diagnostic;
        input.diagnosticSink?.(diagnostic);
      };
      const client = new OkxX402Broker(input.fetchImpl ?? fetch, input.env ?? process.env, {
        correlationId: () => input.correlationId,
        diagnosticSink: sink,
      });
      try {
        const data = await client.verify(paymentPayload, paymentRequirements);
        return {
          data,
          diagnostic: captured ?? fallbackVerifyDiagnostic(input.correlationId, paymentPayload),
          internalCode: "VERIFICATION_ACCEPTED",
        };
      } catch (error) {
        return {
          diagnostic: captured ?? fallbackVerifyDiagnostic(input.correlationId, paymentPayload),
          internalCode: error instanceof A2mcpX402Error
            ? error.code
            : "PAYMENT_VERIFICATION_REJECTED",
        };
      }
    },
  });
}

function fallbackVerifyDiagnostic(
  correlationId: string,
  paymentPayload: X402PaymentPayloadV2
): FacilitatorDiagnostic {
  return {
    event: "repodiet.x402.facilitator",
    phase: "verify",
    correlationId,
    paymentAttemptId: paymentAttemptId({ paymentPayload }),
    timestamp: new Date().toISOString(),
    path: "/api/v6/pay/x402/verify",
    x402Version: paymentPayload.x402Version,
    scheme: paymentPayload.accepted.scheme,
    network: paymentPayload.accepted.network,
    asset: paymentPayload.accepted.asset,
    amount: paymentPayload.accepted.amount,
    recipient: redactAddress(paymentPayload.accepted.payTo),
    validAfter: paymentPayload.payload.authorization.validAfter,
    validBefore: paymentPayload.payload.authorization.validBefore,
  };
}

export class OkxX402Broker implements X402Broker {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly options: OkxX402BrokerOptions = {}
  ) {}

  private async request<T>(method: "GET" | "POST", path: string, body?: JsonRecord): Promise<T> {
    const config = facilitatorConfig(this.env);
    const redact = (value: unknown) => safeBrokerText(value, [config.apiKey, config.secretKey, config.passphrase]);
    const timestamp = (this.options.now?.() ?? new Date()).toISOString();
    const correlationId = this.options.correlationId?.() ?? `x402_${randomUUID()}`;
    const phase = facilitatorPhase(path);
    const attemptId = paymentAttemptId(body);
    const signed = signFacilitatorRequest({ method, path, timestamp, body, secretKey: config.secretKey });
    const emit = (fields: Partial<FacilitatorDiagnostic>) => {
      const diagnostic: FacilitatorDiagnostic = {
        event: "repodiet.x402.facilitator",
        phase,
        correlationId,
        paymentAttemptId: attemptId,
        timestamp,
        path,
        ...diagnosticContext(body),
        ...fields,
      };
      (this.options.diagnosticSink ?? defaultDiagnosticSink)(diagnostic);
    };
    let response: Response;
    try {
      response = await this.fetchImpl(`${config.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "OK-ACCESS-KEY": config.apiKey,
          "OK-ACCESS-SIGN": signed.signature,
          "OK-ACCESS-PASSPHRASE": config.passphrase,
          "OK-ACCESS-TIMESTAMP": timestamp,
        },
        body: signed.bodyText || undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      emit({ okxMessage: "transport unavailable" });
      throw new A2mcpX402Error(
        "FACILITATOR_HTTP_ERROR",
        `OKX payment service is unavailable. Reference: ${correlationId}.`,
        true,
        correlationId
      );
    }
    let envelope: ReturnType<typeof normalizeFacilitatorEnvelope<T>>;
    try {
      envelope = normalizeFacilitatorEnvelope<T>(await response.json());
    } catch {
      emit({ httpStatus: response.status, okxMessage: "non-JSON response" });
      throw new A2mcpX402Error(
        "FACILITATOR_HTTP_ERROR",
        `OKX payment service returned an invalid response. Reference: ${correlationId}.`,
        true,
        correlationId
      );
    }
    const data = envelope.data as VerifyData & SettleData | undefined;
    emit({
      httpStatus: response.status,
      okxCode: redact(envelope.code) ?? undefined,
      okxMessage: redact(envelope.msg) ?? undefined,
      isValid: data?.isValid,
      invalidReason: redact(data?.invalidReason),
      invalidMessage: redact(data?.invalidMessage),
      payer: redactAddress(data?.payer),
      settlementSuccess: data?.success,
      settlementStatus: redact(data?.status) ?? undefined,
      settlementErrorReason: redact(data?.errorReason),
      settlementErrorMessage: redact(data?.errorMessage),
      responseShape: envelope.responseShape,
    });
    if (!response.ok || envelope.code !== "0") {
      const code = brokerErrorCode({
        phase,
        httpStatus: response.status,
        okxCode: envelope.code,
        message: envelope.msg,
      });
      throw new A2mcpX402Error(
        code,
        `OKX payment service rejected the request. Reference: ${correlationId}.`,
        response.status >= 500 || response.status === 429,
        correlationId
      );
    }
    if (phase === "verify" && typeof data?.isValid !== "boolean") {
      throw new A2mcpX402Error(
        "FACILITATOR_RESPONSE_SHAPE_UNRECOGNIZED",
        `OKX payment service returned an unrecognized verification response. Reference: ${correlationId}.`,
        false,
        correlationId
      );
    }
    if (!envelope.data) {
      throw new A2mcpX402Error(
        "FACILITATOR_RESPONSE_SHAPE_UNRECOGNIZED",
        `OKX payment service returned an unrecognized response. Reference: ${correlationId}.`,
        false,
        correlationId
      );
    }
    if (phase === "verify" && data?.isValid !== true) {
      const code = brokerErrorCode({
        phase,
        httpStatus: response.status,
        okxCode: envelope.code,
        message: `${data?.invalidReason ?? ""} ${data?.invalidMessage ?? ""}`,
      });
      throw new A2mcpX402Error(
        code,
        `Payment verification was rejected. Reference: ${correlationId}.`,
        false,
        correlationId
      );
    }
    if (
      phase !== "verify" &&
      data?.success !== true &&
      data?.status !== "timeout" &&
      data?.status !== "pending"
    ) {
      const code = brokerErrorCode({
        phase,
        httpStatus: response.status,
        okxCode: envelope.code,
        message: `${data?.errorReason ?? ""} ${data?.errorMessage ?? ""}`,
      });
      throw new A2mcpX402Error(
        code,
        `Payment settlement was rejected. Reference: ${correlationId}.`,
        false,
        correlationId
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
  if (
    (initial.status !== "timeout" && initial.status !== "pending") ||
    !initial.transaction ||
    !broker.settlementStatus
  ) {
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
        brokerErrorCode({
          phase: "verify",
          httpStatus: 200,
          message: `${verified.invalidReason ?? ""} ${verified.invalidMessage ?? ""}`,
        }),
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
        brokerErrorCode({
          phase: "settle",
          httpStatus: 200,
          message: `${settled.errorReason ?? ""} ${settled.errorMessage ?? ""}`,
        }),
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
