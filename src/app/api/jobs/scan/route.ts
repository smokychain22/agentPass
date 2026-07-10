import { NextResponse } from "next/server";
import { after } from "next/server";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { jobOwnerKey } from "@/lib/jobs/types";
import { createScanJob, runScanJob } from "@/lib/jobs/run-scan-job";
import { getJob, assertJobOwner } from "@/lib/jobs/job-store";

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

    after(async () => {
      await runScanJob(job.id, job.repoUrl, job.branch, ownerKey);
    });

    return NextResponse.json({ success: true, jobId: job.id, status: job.status });
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
