import { NextResponse } from "next/server";
import { getDeepScanJob } from "@/lib/deep-scan/job-store";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const job = await getDeepScanJob(id);
  if (!job) {
    return NextResponse.json({ ok: false, error: "Deep scan job not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    job: {
      id: job.id,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      repositoryOwner: job.repositoryOwner,
      repositoryName: job.repositoryName,
      branch: job.branch,
      sourceCommit: job.sourceCommit,
      projectRoot: job.projectRoot,
      scanId: job.scanId,
      findingsId: job.findingsId,
      graphId: job.graphId,
      coverage: job.coverage,
      baseline: job.baseline,
      resultSummary: job.resultSummary,
      failureCode: job.failureCode,
      failureMessage: job.failureMessage,
      statusHistory: job.statusHistory,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
    },
  });
}
