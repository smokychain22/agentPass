import { NextResponse } from "next/server";

/**
 * Canonical x402 v2 payment challenge shapes expected by OKX / OnchainOS.
 * The PAYMENT-REQUIRED header MUST decode to an object with a nonempty accepts[] array.
 * Do NOT flatten accepts[0] into top-level scheme/network/asset/amount/payTo fields.
 */

export interface X402PaymentAccept {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface X402PaymentChallenge {
  x402Version: number;
  resource: {
    url: string;
    description?: string;
    mimeType?: string;
  };
  accepts: X402PaymentAccept[];
}

const TOP_LEVEL_PAYMENT_FIELDS = [
  "scheme",
  "network",
  "asset",
  "amount",
  "payTo",
  "maxTimeoutSeconds",
] as const;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeAccept(raw: unknown): X402PaymentAccept {
  const entry = asRecord(raw);
  if (!entry) {
    throw new Error("402 response accepts entry is invalid.");
  }
  const scheme = String(entry.scheme ?? "").trim();
  const network = String(entry.network ?? "").trim();
  const asset = String(entry.asset ?? "").trim();
  const amount = String(entry.amount ?? "").trim();
  const payTo = String(entry.payTo ?? "").trim();
  const maxTimeoutSeconds = Number(entry.maxTimeoutSeconds ?? 300);

  if (!scheme || !network || !asset || !amount || !payTo) {
    throw new Error("402 response accepts entry is missing required payment fields.");
  }
  if (!Number.isFinite(maxTimeoutSeconds) || maxTimeoutSeconds <= 0) {
    throw new Error("402 response accepts entry has invalid maxTimeoutSeconds.");
  }

  return {
    scheme,
    network,
    asset,
    amount,
    payTo,
    maxTimeoutSeconds,
    extra: asRecord(entry.extra),
  };
}

/**
 * Build a canonical challenge from a 402 JSON body that already contains accepts[].
 * Preserves every valid advertised payment option (not only accepts[0]).
 */
export function buildX402ChallengeFrom402Body(body: Record<string, unknown>): X402PaymentChallenge {
  if (!Array.isArray(body.accepts) || body.accepts.length === 0) {
    throw new Error("402 response is missing a nonempty accepts[] array.");
  }

  const resource = asRecord(body.resource);
  const url = typeof resource?.url === "string" ? resource.url.trim() : "";
  if (!url) {
    throw new Error("402 response is missing resource.url.");
  }

  const accepts = body.accepts.map(normalizeAccept);
  const description =
    typeof resource?.description === "string"
      ? resource.description
      : typeof body.error === "string"
        ? body.error
        : "RepoDiet A2MCP Quick Triage";

  return {
    x402Version: Number(body.x402Version ?? 2),
    resource: {
      url,
      description,
      mimeType:
        typeof resource?.mimeType === "string" ? resource.mimeType : "application/json",
    },
    accepts,
  };
}

/** Assert challenge is canonical x402 v2 (used by tests and production readiness). */
export function assertCanonicalX402Challenge(challenge: X402PaymentChallenge): void {
  if (challenge.x402Version !== 2) {
    throw new Error(`unsupported x402Version: ${challenge.x402Version}`);
  }
  if (!challenge.resource?.url) {
    throw new Error("challenge missing resource.url");
  }
  if (!Array.isArray(challenge.accepts) || challenge.accepts.length === 0) {
    throw new Error("challenge missing nonempty accepts[]");
  }
  for (const key of TOP_LEVEL_PAYMENT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(challenge, key)) {
      throw new Error(`challenge must not expose top-level payment field: ${key}`);
    }
  }
}

export function encodePaymentRequiredHeader(challenge: X402PaymentChallenge): string {
  assertCanonicalX402Challenge(challenge);
  return Buffer.from(JSON.stringify(challenge), "utf8").toString("base64");
}

export function decodePaymentRequiredHeader(header: string): X402PaymentChallenge {
  const json = Buffer.from(header, "base64").toString("utf8");
  const parsed = JSON.parse(json) as X402PaymentChallenge;
  assertCanonicalX402Challenge(parsed);
  return parsed;
}

/**
 * Emit a 402 whose JSON body and PAYMENT-REQUIRED header are derived from the
 * same canonical challenge object so they cannot drift.
 */
export function paymentRequiredJsonResponse(body: unknown, status = 402): NextResponse {
  const input = asRecord(body) ?? {};
  const challenge = buildX402ChallengeFrom402Body(input);

  // Rebuild body payment fields from the canonical challenge (single source of truth).
  const responseBody = {
    ...input,
    x402Version: challenge.x402Version,
    resource: challenge.resource,
    accepts: challenge.accepts,
  };

  const encoded = encodePaymentRequiredHeader(challenge);
  return NextResponse.json(responseBody, {
    status,
    headers: {
      "PAYMENT-REQUIRED": encoded,
      "Access-Control-Expose-Headers": "PAYMENT-REQUIRED",
      "Cache-Control": "no-store",
    },
  });
}
