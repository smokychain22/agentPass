import { NextResponse } from "next/server";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { jobOwnerKey } from "@/lib/jobs/types";
import { createScanJob, runScanJob } from "@/lib/jobs/run-scan-job";
import { getJob } from "@/lib/jobs/job-store";
import type { ScanJob } from "@/lib/jobs/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const ownerKey = jobOwnerKey(request);
    enforceRateLimit(ownerKey, "scan");

    const body = (await request.json()) as { repoUrl?: string; branch?: string };
    if (!body.repoUrl?.trim()) {
      return NextResponse.json({ success: false, error: "repoUrl is required." }, { status: 422 });
    }

    const job = createScanJob(body.repoUrl.trim(), body.branch?.trim(), ownerKey);
    await runScanJob(job.id, job.repoUrl, job.branch, ownerKey);

    const completed = getJob(job.id) as ScanJob | undefined;
    if (!completed) {
      return NextResponse.json({ success: false, error: "Job completed but not retrievable." }, { status: 500 });
    }

    return NextResponse.json({
      success: completed.status !== "failed",
      jobId: completed.id,
      status: completed.status,
      stage: completed.stage,
      progress: completed.progress,
      isDemo: completed.isDemo,
      result: completed.status === "complete" ? completed.result : undefined,
      error: completed.error,
    });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to create scan job.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
