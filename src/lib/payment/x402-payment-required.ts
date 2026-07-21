/**
 * x402 v2 canonical PAYMENT-REQUIRED header builder.
 *
 * The PAYMENT-REQUIRED header MUST encode the complete canonical challenge object,
 * including the `accepts` array. A flat structure (scheme/network/asset/amount/payTo
 * at the top level) is invalid per x402 v2 and causes OnchainOS CLI to return:
 *   "unsupported: 402 challenge has no accepts[] array"
 *
 * This module implements the required canonical structure:
 * {
 *   "x402Version": 2,
 *   "resource": { "url": "...", "description": "...", "mimeType": "..." },
 *   "accepts": [{ "scheme": "exact", "network": "...", "asset": "...",
 *                 "amount": "...", "payTo": "...", "maxTimeoutSeconds": 300,
 *                 "extra": { "name": "USD₮0", "version": "1" } }]
 * }
 *
 * Next.js App Router compatibility note:
 * The official OKX x402 TypeScript SDK uses Express middleware. We retain the
 * Next.js architecture and manually implement the canonical x402 v2 protocol
 * here rather than forcing an Express migration.
 */
import { NextResponse } from "next/server";

export interface X402AcceptEntry {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface X402Resource {
  url: string;
  description?: string;
  mimeType?: string;
}

/** Canonical x402 v2 challenge. The accepts array must not be flattened. */
export interface X402PaymentChallenge {
  x402Version: number;
  resource: X402Resource;
  accepts: X402AcceptEntry[];
}

export function buildX402ChallengeFrom402Body(body: Record<string, unknown>): X402PaymentChallenge {
  const accepts = Array.isArray(body.accepts) ? body.accepts : undefined;
  if (!accepts || accepts.length === 0) {
    throw new Error("402 response is missing accepts[] array.");
  }
  const resource = body.resource as X402Resource | undefined;
  if (!resource?.url) {
    throw new Error("402 response is missing resource.url.");
  }
  // Validate all accept entries are structurally complete.
  for (let i = 0; i < accepts.length; i++) {
    const entry = accepts[i] as Record<string, unknown> | undefined;
    if (!entry || !entry.scheme || !entry.network || !entry.asset || !entry.amount || !entry.payTo) {
      throw new Error(`accepts[${i}] is missing required fields (scheme/network/asset/amount/payTo).`);
    }
  }
  return {
    x402Version: Number(body.x402Version ?? 2),
    resource: {
      url: resource.url,
      description: resource.description,
      mimeType: resource.mimeType ?? "application/json",
    },
    // Preserve the full accepts array — do NOT flatten fields to the top level.
    accepts: (accepts as Record<string, unknown>[]).map((entry) => ({
      scheme: String(entry.scheme),
      network: String(entry.network),
      asset: String(entry.asset),
      amount: String(entry.amount),
      payTo: String(entry.payTo),
      maxTimeoutSeconds: Number(entry.maxTimeoutSeconds ?? 300),
      extra: entry.extra as Record<string, unknown> | undefined,
    })),
  };
}

export function encodePaymentRequiredHeader(challenge: X402PaymentChallenge): string {
  return Buffer.from(JSON.stringify(challenge), "utf8").toString("base64");
}

export function decodePaymentRequiredHeader(header: string): X402PaymentChallenge {
  const json = Buffer.from(header, "base64").toString("utf8");
  return JSON.parse(json) as X402PaymentChallenge;
}

export function paymentRequiredJsonResponse(body: unknown, status = 402): NextResponse {
  const challenge = buildX402ChallengeFrom402Body(body as Record<string, unknown>);
  const encoded = encodePaymentRequiredHeader(challenge);
  return NextResponse.json(body, {
    status,
    headers: {
      "PAYMENT-REQUIRED": encoded,
      "Access-Control-Expose-Headers": "PAYMENT-REQUIRED",
      // Prevent intermediary caches from storing 402 challenges.
      "Cache-Control": "no-store",
    },
  });
}
