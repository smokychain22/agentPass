import { NextResponse } from "next/server";
import { RateLimitError } from "@/lib/security/rate-limit";

export function rateLimitJsonResponse(err: RateLimitError): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: err.message,
      rateLimit: err.toJSON(),
    },
    { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } }
  );
}
