import { NextResponse } from "next/server";
import {
  claimNextRepositoryJob,
  completeRepositoryJob,
  failRepositoryJob,
  getRepositoryJob,
  heartbeatRepositoryJob,
  updateRepositoryJob,
} from "@/lib/worker/repository-job-store";
import { assertWorkerAuthorized } from "@/lib/worker/worker-auth";
import type { RepositoryJobResult, RepositoryJobStatus } from "@/lib/worker/types";

export const runtime = "nodejs";

function workerError(message: string, status = 401) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertWorkerAuthorized(request);
    const { id } = await context.params;
    const body = (await request.json()) as { workerId?: string };
    const workerId = body.workerId?.trim();
    if (!workerId) return workerError("workerId is required.", 400);

    const job = await claimNextRepositoryJob(workerId);
    if (!job || job.id !== id) {
      const direct = await getRepositoryJob(id);
      if (!direct) return workerError("Job not found.", 404);
      if (direct.status !== "queued") {
        return NextResponse.json({ ok: false, error: "Job already claimed.", job: direct }, { status: 409 });
      }
      return workerError("Job claim failed.", 409);
    }

    return NextResponse.json({ ok: true, job });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Claim failed.";
    return workerError(message, message.includes("Unauthorized") ? 401 : 500);
  }
}
