import { NextResponse } from "next/server";
import { jobOwnerKey } from "@/lib/jobs/types";
import { getJob, assertJobOwner } from "@/lib/jobs/job-store";
import type { FindingsJob } from "@/lib/jobs/types";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await context.params;
  const job = await getJob(jobId);

  if (!job || job.type !== "findings") {
    return NextResponse.json({ success: false, error: "Job not found." }, { status: 404 });
  }

  try {
    assertJobOwner(job, jobOwnerKey(request));
  } catch {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 403 });
  }

  const findingsJob = job as FindingsJob;
  return NextResponse.json({
    success: true,
    jobId: findingsJob.id,
    status: findingsJob.status,
    stage: findingsJob.stage,
    progress: findingsJob.progress,
    isDemo: findingsJob.isDemo,
    scanId: findingsJob.scanId,
    result: findingsJob.status === "complete" ? findingsJob.result : undefined,
    error: findingsJob.error,
  });
}
