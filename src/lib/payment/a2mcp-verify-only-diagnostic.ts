import { createHash, randomUUID } from "node:crypto";
import { parseGitHubUrl } from "@/lib/github/parse-github-url";
import { resolveBindingFromBody } from "@/lib/okx/a2mcp-adapter";
import { isRedisPersistenceEnabled } from "@/lib/server/runtime-env";
import {
  getDurableRecord,
  setDurableRecord,
  setDurableRecordIfAbsentWithTtl,
} from "@/lib/store/durable-store";
import {
  createOkxX402VerifyOnlyClient,
  A2mcpX402Error,
  decodePaymentSignatureHeader,
  paymentRequirementsFromQuote,
  quoteIdFromPaymentPayload,
  redactX402DiagnosticText,
  validatePaymentPayloadForRequest,
  type X402VerifyOnlyClient,
} from "./a2mcp-x402-production";
import { getBoundQuote } from "./payment-store";

type JsonRecord = Record<string, unknown>;

const DIAGNOSTIC_TTL_SECONDS = 60 * 60;
const ATTEMPT_MAX_AGE_MS = 5 * 60 * 1000;
const FUTURE_CLOCK_SKEW_MS = 30 * 1000;

export interface VerifyOnlyDiagnosticRequest {
  attemptId: string;
  attemptCreatedAt: string;
  paymentSignature: string;
  originalRequest: JsonRecord;
  originalResourceUrl: string;
  paymentRequirements: JsonRecord;
}

export interface VerifyOnlyDiagnosticResponse {
  ok: boolean;
  correlationId: string;
  attemptId: string;
  verification: {
    httpStatus: number;
    code: string;
    msg: string;
    isValid: boolean;
    invalidReason: string | null;
    invalidMessage: string | null;
  };
  settlementAttempted: false;
  findingsReleased: false;
  receiptCreated: false;
}

interface DiagnosticAttemptRecord {
  attemptId: string;
  authorizationFingerprint: string;
  correlationId: string;
  createdAt: string;
  consumed: boolean;
  localValidationPassed: boolean;
  requestBodyHashPrefix: string;
  resourceUrl: string;
  verificationAttempted: boolean;
  result?: VerifyOnlyDiagnosticResponse;
}

export class VerifyOnlyDiagnosticError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 422,
    readonly correlationId?: string,
    readonly attemptId?: string
  ) {
    super(message);
    this.name = "VerifyOnlyDiagnosticError";
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const input = value as JsonRecord;
  return Object.fromEntries(
    Object.keys(input).sort().map((key) => [key, canonicalize(input[key])])
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function requireAttempt(request: VerifyOnlyDiagnosticRequest, nowMs: number): void {
  if (!/^diag_[A-Za-z0-9_-]{16,80}$/.test(request.attemptId)) {
    throw new VerifyOnlyDiagnosticError("INVALID_ATTEMPT", "Diagnostic attempt identifier is invalid.", 400);
  }
  const createdAt = new Date(request.attemptCreatedAt).getTime();
  if (!Number.isFinite(createdAt)) {
    throw new VerifyOnlyDiagnosticError("INVALID_ATTEMPT", "Diagnostic attempt timestamp is invalid.", 400);
  }
  if (createdAt < nowMs - ATTEMPT_MAX_AGE_MS || createdAt > nowMs + FUTURE_CLOCK_SKEW_MS) {
    throw new VerifyOnlyDiagnosticError("EXPIRED_ATTEMPT", "Diagnostic attempt has expired.", 409);
  }
}

function originalQuickTriageBody(input: JsonRecord, quote: Awaited<ReturnType<typeof getBoundQuote>>): JsonRecord {
  if (!quote) throw new VerifyOnlyDiagnosticError("QUOTE_NOT_FOUND", "Payment quote was not found.", 404);
  const allowed = new Set(["operation", "repositoryUrl", "branch", "maximumFindings"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new VerifyOnlyDiagnosticError("REQUEST_MISMATCH", "Original request contains unsupported fields.");
  }
  if (input.operation !== "analyze_repository") {
    throw new VerifyOnlyDiagnosticError("REQUEST_MISMATCH", "Original operation does not match Quick Triage.");
  }
  const repositoryUrl = typeof input.repositoryUrl === "string" ? input.repositoryUrl.trim() : "";
  const parsed = parseGitHubUrl(repositoryUrl);
  if (!parsed || `${parsed.owner}/${parsed.repo}`.toLowerCase() !== quote.repository.toLowerCase()) {
    throw new VerifyOnlyDiagnosticError("REQUEST_MISMATCH", "Original repository does not match the quote.");
  }
  const branch = typeof input.branch === "string" ? input.branch.trim() : "main";
  if (branch !== quote.branch) {
    throw new VerifyOnlyDiagnosticError("REQUEST_MISMATCH", "Original branch does not match the quote.");
  }
  const maximumFindings = Number(input.maximumFindings ?? 10);
  if (!Number.isInteger(maximumFindings) || maximumFindings < 1 || maximumFindings > 10) {
    throw new VerifyOnlyDiagnosticError("REQUEST_MISMATCH", "maximumFindings must be an integer from 1 to 10.");
  }
  return {
    repoUrl: repositoryUrl,
    repositoryUrl,
    branch: quote.branch,
    commitSha: quote.commitSha,
    maximumFindings,
    source: "quick_triage",
    operation: "analyze_repository",
    quoteId: undefined,
    paymentReference: undefined,
    payer: undefined,
    idempotencyKey: undefined,
  };
}

function requirementsMatch(actual: JsonRecord, expected: JsonRecord): boolean {
  return canonicalJson(actual) === canonicalJson(expected);
}

function recordKey(prefix: "attempt" | "authorization", value: string): string {
  return `verify_diag_${prefix}_${createHash("sha256").update(value).digest("hex")}`;
}

export async function runVerifyOnlyDiagnostic(input: {
  request: VerifyOnlyDiagnosticRequest;
  client?: X402VerifyOnlyClient;
  nowMs?: number;
}): Promise<VerifyOnlyDiagnosticResponse> {
  const nowMs = input.nowMs ?? Date.now();
  requireAttempt(input.request, nowMs);
  if (
    (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") &&
    !isRedisPersistenceEnabled()
  ) {
    throw new VerifyOnlyDiagnosticError(
      "DURABLE_DIAGNOSTIC_STORE_REQUIRED",
      "Durable diagnostic storage is not configured.",
      503
    );
  }

  const correlationId = `x402_diag_${randomUUID()}`;
  let payload;
  try {
    payload = decodePaymentSignatureHeader(input.request.paymentSignature);
  } catch {
    throw new VerifyOnlyDiagnosticError(
      "PAYMENT_PAYLOAD_INVALID",
      "Payment authorization is invalid.",
      422,
      correlationId,
      input.request.attemptId
    );
  }
  const quoteId = quoteIdFromPaymentPayload(payload);
  if (!quoteId) {
    throw new VerifyOnlyDiagnosticError("QUOTE_NOT_FOUND", "Payment quote identifier is missing.", 422, correlationId, input.request.attemptId);
  }
  const quote = await getBoundQuote(quoteId);
  const forwardedBody = originalQuickTriageBody(input.request.originalRequest, quote);
  if (!quote) throw new VerifyOnlyDiagnosticError("QUOTE_NOT_FOUND", "Payment quote was not found.", 404, correlationId, input.request.attemptId);
  if (
    !input.request.originalResourceUrl ||
    input.request.originalResourceUrl !== quote.resourceUrl ||
    input.request.originalResourceUrl !== payload.resource.url
  ) {
    throw new VerifyOnlyDiagnosticError(
      "RESOURCE_MISMATCH",
      "Protected resource does not match the payment authorization.",
      422,
      correlationId,
      input.request.attemptId
    );
  }
  const expectedRequirements = paymentRequirementsFromQuote(quote);
  if (!requirementsMatch(input.request.paymentRequirements, expectedRequirements)) {
    throw new VerifyOnlyDiagnosticError("PAYMENT_REQUIREMENTS_MISMATCH", "Payment requirements do not match the quote.", 422, correlationId, input.request.attemptId);
  }
  try {
    const binding = await resolveBindingFromBody(forwardedBody, "analyze_repository", {
      url: quote.resourceUrl ?? payload.resource.url,
      method: "POST",
    });
    validatePaymentPayloadForRequest({
      payload,
      quote,
      binding,
      nowSeconds: Math.floor(nowMs / 1000),
    });
  } catch (error) {
    if (error instanceof A2mcpX402Error) {
      throw new VerifyOnlyDiagnosticError(
        error.code,
        "Payment authorization does not match the protected request.",
        422,
        correlationId,
        input.request.attemptId
      );
    }
    throw new VerifyOnlyDiagnosticError(
      "REQUEST_MISMATCH",
      "Original request could not be bound to the payment authorization.",
      422,
      correlationId,
      input.request.attemptId
    );
  }

  const fingerprint = digest(payload);
  const bodyHash = digest(forwardedBody);
  const reservation: DiagnosticAttemptRecord = {
    attemptId: input.request.attemptId,
    authorizationFingerprint: fingerprint,
    correlationId,
    createdAt: new Date(nowMs).toISOString(),
    consumed: true,
    localValidationPassed: true,
    requestBodyHashPrefix: bodyHash.slice(0, 16),
    resourceUrl: payload.resource.url,
    verificationAttempted: false,
  };
  const attemptKey = recordKey("attempt", input.request.attemptId);
  const authorizationKey = recordKey("authorization", fingerprint);
  const attemptClaimed = await setDurableRecordIfAbsentWithTtl(
    "payment_entitlements",
    attemptKey,
    reservation,
    DIAGNOSTIC_TTL_SECONDS
  );
  if (!attemptClaimed) {
    throw new VerifyOnlyDiagnosticError("REUSED_DIAGNOSTIC_ATTEMPT", "Diagnostic attempt was already consumed.", 409, correlationId, input.request.attemptId);
  }
  const authorizationClaimed = await setDurableRecordIfAbsentWithTtl(
    "payment_entitlements",
    authorizationKey,
    reservation,
    DIAGNOSTIC_TTL_SECONDS
  );
  if (!authorizationClaimed) {
    throw new VerifyOnlyDiagnosticError("REUSED_AUTHORIZATION", "Payment authorization was already diagnosed.", 409, correlationId, input.request.attemptId);
  }

  const client = input.client ?? createOkxX402VerifyOnlyClient({ correlationId });
  const verified = await client.verify(payload, expectedRequirements);
  const result: VerifyOnlyDiagnosticResponse = {
    ok: verified.data?.isValid === true,
    correlationId,
    attemptId: input.request.attemptId,
    verification: {
      httpStatus: verified.diagnostic.httpStatus ?? 0,
      code: redactX402DiagnosticText(verified.diagnostic.okxCode ?? verified.internalCode),
      msg: redactX402DiagnosticText(verified.diagnostic.okxMessage),
      isValid: verified.data?.isValid === true,
      invalidReason: verified.diagnostic.invalidReason == null
        ? null
        : redactX402DiagnosticText(verified.diagnostic.invalidReason),
      invalidMessage: verified.diagnostic.invalidMessage == null
        ? null
        : redactX402DiagnosticText(verified.diagnostic.invalidMessage),
    },
    settlementAttempted: false,
    findingsReleased: false,
    receiptCreated: false,
  };
  const completed: DiagnosticAttemptRecord = {
    ...reservation,
    verificationAttempted: true,
    result,
  };
  await Promise.all([
    setDurableRecord("payment_entitlements", attemptKey, completed),
    setDurableRecord("payment_entitlements", authorizationKey, completed),
  ]);
  console.error(JSON.stringify({
    event: "repodiet.x402.verify_only",
    correlationId,
    attemptId: input.request.attemptId,
    timestamp: completed.createdAt,
    httpStatus: result.verification.httpStatus,
    okxCode: result.verification.code,
    okxMessage: result.verification.msg,
    isValid: result.verification.isValid,
    invalidReason: result.verification.invalidReason,
    invalidMessage: result.verification.invalidMessage,
    internalCode: verified.internalCode,
    brokerPath: verified.diagnostic.path,
    x402Version: payload.x402Version,
    scheme: payload.accepted.scheme,
    network: payload.accepted.network,
    asset: payload.accepted.asset,
    amount: payload.accepted.amount,
    payTo: verified.diagnostic.recipient,
    payer: verified.diagnostic.payer,
    validAfter: payload.payload.authorization.validAfter,
    validBefore: payload.payload.authorization.validBefore,
    localValidationPassed: true,
    requestBodyHashPrefix: completed.requestBodyHashPrefix,
    resourceUrl: payload.resource.url,
    verificationAttempted: true,
    settlementAttempted: false,
  }));
  return result;
}

export async function getVerifyDiagnosticAttemptForTest(attemptId: string) {
  return getDurableRecord<DiagnosticAttemptRecord>(
    "payment_entitlements",
    recordKey("attempt", attemptId)
  );
}
