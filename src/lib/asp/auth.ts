import { timingSafeEqual } from "node:crypto";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";

const ASP_RATE_LIMIT = 120;

function readAspOperatorKey(): string | undefined {
  return process.env.ASP_OPERATOR_KEY?.trim() || undefined;
}

export function isAspOperatorConfigured(): boolean {
  return Boolean(readAspOperatorKey());
}

export function getAspPublicBaseUrl(): string {
  const configured = process.env.ASP_PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const fallback = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fallback) return fallback.replace(/\/$/, "");
  return "http://localhost:3000";
}

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function verifyAspOperatorAuthorization(request: Request): {
  ok: true;
  operatorKey: string;
} | {
  ok: false;
  status: number;
  error: string;
} {
  const expected = readAspOperatorKey();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: "ASP operator key is not configured on this deployment.",
    };
  }

  const header = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const provided = match?.[1]?.trim();
  if (!provided || !constantTimeEqual(provided, expected)) {
    return { ok: false, status: 401, error: "Invalid ASP operator credentials." };
  }

  return { ok: true, operatorKey: expected };
}

export async function enforceAspRateLimit(request: Request): Promise<void> {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ownerKey = forwarded || "asp-operator";
  await enforceRateLimit(ownerKey, "asp", { limit: ASP_RATE_LIMIT });
}

export function aspAuthErrorResponse(
  result: { status: number; error: string },
  rateLimit?: RateLimitError
): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (rateLimit) {
    headers["Retry-After"] = String(rateLimit.retryAfterSeconds);
  }
  return new Response(JSON.stringify({ ok: false, error: result.error }), {
    status: rateLimit ? 429 : result.status,
    headers,
  });
}
