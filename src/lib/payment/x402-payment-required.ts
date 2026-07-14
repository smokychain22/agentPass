import { NextResponse } from "next/server";

export interface X402PaymentChallenge {
  x402Version: number;
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  resource: { url: string; mimeType?: string };
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export function buildX402ChallengeFrom402Body(body: Record<string, unknown>): X402PaymentChallenge {
  const accepts = Array.isArray(body.accepts)
    ? (body.accepts[0] as Record<string, unknown> | undefined)
    : undefined;
  if (!accepts) {
    throw new Error("402 response is missing accepts[0].");
  }
  const resource = body.resource as { url: string; mimeType?: string } | undefined;
  if (!resource?.url) {
    throw new Error("402 response is missing resource.url.");
  }
  return {
    x402Version: Number(body.x402Version ?? 2),
    scheme: String(accepts.scheme ?? "exact"),
    network: String(accepts.network),
    asset: String(accepts.asset),
    amount: String(accepts.amount),
    payTo: String(accepts.payTo),
    resource: {
      url: resource.url,
      mimeType: resource.mimeType ?? "application/json",
    },
    maxTimeoutSeconds: Number(accepts.maxTimeoutSeconds ?? 300),
    extra: accepts.extra as Record<string, unknown> | undefined,
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
    },
  });
}
