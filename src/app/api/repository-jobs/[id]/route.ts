import { NextResponse } from "next/server";
import { getRepositoryJob } from "@/lib/worker/repository-job-store";
import { getLatestWorkerHeartbeat } from "@/lib/worker/worker-instance-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const job = await getRepositoryJob(id);
    if (!job) {
      return NextResponse.json({ ok: false, error: "Job not found." }, { status: 404 });
    }

    const worker = await getLatestWorkerHeartbeat();
    const terminal = ["delivered", "failed", "blocked", "timed_out"].includes(job.status);

    return NextResponse.json({
      ok: true,
      job: {
        id: job.id,
        cleanupRunId: job.cleanupRunId,
        status: job.status,
        progress: job.progress,
        statusHistory: job.statusHistory,
        failureCode: job.failureCode,
        failureMessage: job.failureMessage,
        result: job.result,
        claimedBy: job.claimedBy,
        heartbeatAt: job.heartbeatAt,
        leaseExpiresAt: job.leaseExpiresAt,
        attemptCount: job.attemptCount,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt,
      },
      worker: worker
        ? {
            id: worker.id,
            status: worker.status,
            heartbeatAt: worker.heartbeatAt,
            gitVersion: worker.gitVersion,
            nodeVersion: worker.nodeVersion,
            npmVersion: worker.npmVersion,
          }
        : null,
      terminal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load job.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
