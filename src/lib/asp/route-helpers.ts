import { NextResponse } from "next/server";
import {
  aspAuthErrorResponse,
  enforceAspRateLimit,
  verifyAspOperatorAuthorization,
} from "@/lib/asp/auth";
import { RateLimitError } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function withAspOperatorAuth(
  request: Request,
  handler: () => Promise<Response>
): Promise<Response> {
  try {
    await enforceAspRateLimit(request);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return aspAuthErrorResponse({ status: 429, error: err.message }, err);
    }
    throw err;
  }

  const auth = verifyAspOperatorAuthorization(request);
  if (!auth.ok) {
    return aspAuthErrorResponse(auth);
  }

  return handler();
}

export function aspJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function aspError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}
