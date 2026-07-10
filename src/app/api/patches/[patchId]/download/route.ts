import { NextResponse } from "next/server";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { jobOwnerKey } from "@/lib/jobs/types";
import { getStoredPatchKit } from "@/lib/patch-kit/patch-kit-store";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ patchId: string }> }
) {
  try {
    const ownerKey = jobOwnerKey(request);
    enforceRateLimit(ownerKey, "download");

    const { patchId } = await context.params;
    const stored = getStoredPatchKit(patchId);

    if (!stored) {
      return NextResponse.json({ success: false, error: "Patch bundle not found." }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(stored.zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${stored.filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } }
      );
    }
    const message = err instanceof Error ? err.message : "Download failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
