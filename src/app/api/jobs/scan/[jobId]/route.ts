import { NextResponse } from "next/server";
import { jobOwnerKey } from "@/lib/jobs/types";
import { getJob, assertJobOwner } from "@/lib/jobs/job-store";
import type { ScanJob } from "@/lib/jobs/types";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await context.params;
  const job = await getJob(jobId);

  if (!job || job.type !== "scan") {
    return NextResponse.json({ success: false, error: "Job not found." }, { status: 404 });
  }

  try {
    assertJobOwner(job, jobOwnerKey(request));
  } catch {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 403 });
  }

  const scanJob = job as ScanJob;
  return NextResponse.json({
    success: true,
    jobId: scanJob.id,
    status: scanJob.status,
    stage: scanJob.stage,
    progress: scanJob.progress,
    isDemo: scanJob.isDemo,
    result: scanJob.status === "complete" ? scanJob.result : undefined,
    error: scanJob.error,
  });
}
