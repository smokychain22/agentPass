import { NextResponse } from "next/server";
import { jobOwnerKey } from "@/lib/jobs/types";
import { getJob, assertJobOwner } from "@/lib/jobs/job-store";
import type { PatchJob } from "@/lib/jobs/types";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await context.params;
  const job = await getJob(jobId);

  if (!job || job.type !== "patch") {
    return NextResponse.json({ success: false, error: "Job not found." }, { status: 404 });
  }

  try {
    assertJobOwner(job, jobOwnerKey(request));
  } catch {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 403 });
  }

  const patchJob = job as PatchJob;
  return NextResponse.json({
    success: true,
    jobId: patchJob.id,
    status: patchJob.status,
    stage: patchJob.stage,
    progress: patchJob.progress,
    isDemo: patchJob.isDemo,
    patchValidation: patchJob.patchValidation,
    result: patchJob.status === "complete" ? patchJob.result : undefined,
    error: patchJob.error,
  });
}
