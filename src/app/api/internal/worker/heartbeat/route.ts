import { NextResponse } from "next/server";
import { heartbeatWorkerInstance } from "@/lib/worker/worker-instance-store";
import { assertWorkerAuthorized, WorkerAuthError } from "@/lib/worker/worker-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertWorkerAuthorized(request);
    const body = (await request.json()) as {
      workerId?: string;
      status?: "online" | "busy" | "degraded";
      currentJobId?: string;
    };
    const workerId = body.workerId?.trim();
    if (!workerId) {
      return NextResponse.json({ ok: false, error: "workerId is required." }, { status: 400 });
    }
    const instance = await heartbeatWorkerInstance(workerId, {
      status: body.status ?? "online",
      currentJobId: body.currentJobId,
    });
    if (!instance) {
      return NextResponse.json({ ok: false, error: "Worker not registered." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, worker: instance });
  } catch (err) {
    if (err instanceof WorkerAuthError) {
      return NextResponse.json({ ok: false, code: err.code, error: err.message }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Heartbeat failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
