import { NextResponse } from "next/server";
import { getRepositoryJob, heartbeatRepositoryJob } from "@/lib/worker/repository-job-store";
import { assertWorkerAuthorized } from "@/lib/worker/worker-auth";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertWorkerAuthorized(request);
    const { id } = await context.params;
    const body = (await request.json()) as { workerId?: string };
    const workerId = body.workerId?.trim();
    if (!workerId) {
      return NextResponse.json({ ok: false, error: "workerId is required." }, { status: 400 });
    }
    const ok = await heartbeatRepositoryJob(id, workerId);
    if (!ok) {
      return NextResponse.json({ ok: false, error: "Heartbeat rejected." }, { status: 409 });
    }
    const job = await getRepositoryJob(id);
    return NextResponse.json({ ok: true, job });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Heartbeat failed.";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message.includes("Unauthorized") ? 401 : 500 }
    );
  }
}
