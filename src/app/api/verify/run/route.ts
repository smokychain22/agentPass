import { NextResponse } from "next/server";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { jobOwnerKey } from "@/lib/jobs/types";
import { durableId, durableNow, setDurableRecord } from "@/lib/store/durable-store";
import { getStoredPatchKit } from "@/lib/patch-kit/patch-kit-store";
import { runVerification } from "@/lib/verify/run-verification";
import { isDemoRepoUrl } from "@/lib/demo/constants";
import { enforcePayment } from "@/lib/payment/x402";

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

    const stored = getStoredPatchKit(body.patchId.trim());
    if (!stored) {
      return NextResponse.json({ success: false, error: "Patch bundle not found." }, { status: 404 });
    }

    const repoUrl = `https://github.com/${stored.payload.repo.owner}/${stored.payload.repo.name}`;
    enforcePayment(request, "verify_run", { free: isDemoRepoUrl(repoUrl) });

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
    const paymentErr = err as Error & { status?: number; body?: unknown };
    if (paymentErr.status === 402) {
      return NextResponse.json(paymentErr.body, { status: 402 });
    }
    const message = err instanceof Error ? err.message : "Verification failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
