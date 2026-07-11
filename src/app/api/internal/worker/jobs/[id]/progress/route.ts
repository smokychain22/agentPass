import { NextResponse } from "next/server";
import { updateRepositoryJob, getRepositoryJob } from "@/lib/worker/repository-job-store";
import { assertWorkerAuthorized } from "@/lib/worker/worker-auth";
import type { RepositoryJobStatus } from "@/lib/worker/types";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertWorkerAuthorized(request);
    const { id } = await context.params;
    const body = (await request.json()) as { workerId?: string; status?: RepositoryJobStatus; progress?: string };
    const workerId = body.workerId?.trim();
    if (!workerId) {
      return NextResponse.json({ ok: false, error: "workerId is required." }, { status: 400 });
    }
    const job = await getRepositoryJob(id);
    if (!job || job.claimedBy !== workerId) {
      return NextResponse.json({ ok: false, error: "Job not owned by worker." }, { status: 409 });
    }
    const updated = await updateRepositoryJob(id, {
      status: body.status ?? job.status,
      progress: body.progress,
      heartbeatAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, job: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Progress update failed.";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message.includes("Unauthorized") ? 401 : 500 }
    );
  }
}
