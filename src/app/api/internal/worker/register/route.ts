import { NextResponse } from "next/server";
import { registerWorkerInstance } from "@/lib/worker/worker-instance-store";
import { assertWorkerAuthorized } from "@/lib/worker/worker-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertWorkerAuthorized(request);
    const body = (await request.json()) as {
      workerId?: string;
      version?: string;
      hostname?: string;
      gitVersion?: string;
      nodeVersion?: string;
      npmVersion?: string;
    };

    const instance = await registerWorkerInstance({
      id: body.workerId,
      version: body.version,
      hostname: body.hostname,
      gitVersion: body.gitVersion,
      nodeVersion: body.nodeVersion,
      npmVersion: body.npmVersion,
    });

    return NextResponse.json({ ok: true, worker: instance });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Register failed.";
    const status = message.includes("Unauthorized") ? 401 : 500;
    const code = message.includes("Unauthorized") ? "WORKER_AUTH_INVALID" : "REGISTER_FAILED";
    return NextResponse.json({ ok: false, code, error: message }, { status });
  }
}
