import { NextResponse } from "next/server";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { jobOwnerKey } from "@/lib/jobs/types";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Legacy findings job endpoint — no longer runs analyzers in-request.
 * Delegates to durable /api/findings/analyze (202).
 */
export async function POST(request: Request) {
  try {
    const ownerKey = jobOwnerKey(request);
    await enforceRateLimit(ownerKey, "findings");

    const body = (await request.json()) as {
      repoUrl?: string;
      branch?: string;
      scanId?: string;
      projectRoot?: string;
      sourceCommit?: string;
    };
    if (!body.repoUrl?.trim()) {
      return NextResponse.json({ success: false, error: "repoUrl is required." }, { status: 422 });
    }
    if (!body.scanId?.trim()) {
      return NextResponse.json(
        {
          success: false,
          code: "SCAN_NOT_FOUND",
          error: "scanId (structureScanId) is required for durable findings analysis.",
        },
        { status: 422 }
      );
    }

    // Forward to durable analyze route in-process.
    const { POST: analyze } = await import("@/app/api/findings/analyze/route");
    const forwarded = new Request(new URL("/api/findings/analyze", request.url), {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({
        structureScanId: body.scanId.trim(),
        repoUrl: body.repoUrl.trim(),
        branch: body.branch?.trim(),
        projectRoot: body.projectRoot?.trim(),
        sourceCommit: body.sourceCommit?.trim(),
      }),
    });
    return analyze(forwarded);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to enqueue findings job.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
