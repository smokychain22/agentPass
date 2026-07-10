import { NextResponse } from "next/server";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { jobOwnerKey } from "@/lib/jobs/types";
import { durableId, durableNow, setDurableRecord } from "@/lib/store/durable-store";
import { runVerification } from "@/lib/verify/run-verification";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const ownerKey = jobOwnerKey(request);
    enforceRateLimit(ownerKey, "verify");

    const body = (await request.json()) as { patchId?: string };
    if (!body.patchId?.trim()) {
      return NextResponse.json({ success: false, error: "patchId is required." }, { status: 422 });
    }

    const result = await runVerification(body.patchId.trim());
    const verificationId = durableId("verify");

    setDurableRecord("verifications", verificationId, {
      id: verificationId,
      patchId: body.patchId,
      ownerKey,
      createdAt: durableNow(),
      ...result,
    });

    return NextResponse.json({
      success: true,
      verificationId,
      ...result,
    });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } }
      );
    }
    const message = err instanceof Error ? err.message : "Verification failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
