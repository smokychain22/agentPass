import { NextResponse } from "next/server";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { jobOwnerKey } from "@/lib/jobs/types";
import type { CommerceOperation } from "@/lib/payment/types";
import { createQuoteForOperation, quoteTo402Response } from "@/lib/payment";
import { paymentRequiredJsonResponse } from "@/lib/payment/x402-payment-required";
import { canonicalResourceUrl } from "@/lib/payment/canonical-app-url";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ownerKey = jobOwnerKey(request);
    await enforceRateLimit(ownerKey, "scan");

    const body = (await request.json()) as {
      repository: string;
      branch?: string;
      commitSha: string;
      findingIds?: string[];
      operation: CommerceOperation;
      sourceFileCount?: number;
      idempotencyKey?: string;
      verificationProfile?: "standard" | "strict";
    };

    if (!body.repository || !body.commitSha || !body.operation) {
      return NextResponse.json(
        { success: false, error: "repository, commitSha, and operation are required." },
        { status: 400 }
      );
    }

    const quote = await createQuoteForOperation({
      repository: body.repository,
      branch: body.branch ?? "main",
      commitSha: body.commitSha,
      findingIds: body.findingIds ?? [],
      operation: body.operation,
      sourceFileCount: body.sourceFileCount,
      idempotencyKey: body.idempotencyKey,
    });

    if (quote.amountMicro !== "0") {
      const resourceUrl = canonicalResourceUrl("/api/tasks/quote", request.url);
      return paymentRequiredJsonResponse(quoteTo402Response(quote, resourceUrl), 402);
    }

    return NextResponse.json({
      success: true,
      quote,
      lifecycleStatus: quote.lifecycleStatus,
    });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } }
      );
    }
    const message = err instanceof Error ? err.message : "Quote failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
