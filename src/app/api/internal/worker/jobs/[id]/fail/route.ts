import { NextResponse } from "next/server";
import { failRepositoryJob } from "@/lib/worker/repository-job-store";
import { assertWorkerAuthorized, validateWorkerCallbackSecret } from "@/lib/worker/worker-auth";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const callback = request.headers.get("x-worker-callback-secret");
    if (callback) {
      if (!validateWorkerCallbackSecret(callback)) {
        return NextResponse.json({ ok: false, error: "Invalid callback secret." }, { status: 401 });
      }
    } else {
      assertWorkerAuthorized(request);
    }

    const { id } = await context.params;
    const body = (await request.json()) as {
      workerId?: string;
      failureCode?: string;
      failureMessage?: string;
    };
    const workerId = body.workerId?.trim();
    if (!workerId || !body.failureCode) {
      return NextResponse.json(
        { ok: false, error: "workerId and failureCode are required." },
        { status: 400 }
      );
    }

    const job = await failRepositoryJob(
      id,
      workerId,
      body.failureCode,
      body.failureMessage ?? body.failureCode
    );
    if (!job) {
      return NextResponse.json({ ok: false, error: "Fail rejected." }, { status: 409 });
    }
    return NextResponse.json({ ok: true, job });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fail failed.";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message.includes("Unauthorized") ? 401 : 500 }
    );
  }
}
