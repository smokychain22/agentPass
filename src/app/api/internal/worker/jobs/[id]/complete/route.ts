import { NextResponse } from "next/server";
import { completeRepositoryJob, getRepositoryJob } from "@/lib/worker/repository-job-store";
import { assertWorkerAuthorized, validateWorkerCallbackSecret } from "@/lib/worker/worker-auth";
import { getStoredPatchKit, storePatchKit } from "@/lib/patch-kit/patch-kit-store";
import type { RepositoryJobResult, RepositoryJobStatus } from "@/lib/worker/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const callback = request.headers.get("x-worker-callback-secret");
    const auth = request.headers.get("authorization");
    if (!validateWorkerCallbackSecret(callback) && !auth) {
      assertWorkerAuthorized(request);
    } else if (callback) {
      if (!validateWorkerCallbackSecret(callback)) {
        return NextResponse.json({ ok: false, error: "Invalid callback secret." }, { status: 401 });
      }
    } else {
      assertWorkerAuthorized(request);
    }

    const { id } = await context.params;
    const body = (await request.json()) as {
      workerId?: string;
      status?: RepositoryJobStatus;
      result?: RepositoryJobResult;
    };
    const workerId = body.workerId?.trim();
    if (!workerId || !body.result) {
      return NextResponse.json({ ok: false, error: "workerId and result are required." }, { status: 400 });
    }

    const job = await completeRepositoryJob(
      id,
      workerId,
      body.result,
      body.status ?? "ready_for_delivery"
    );
    if (!job) {
      return NextResponse.json({ ok: false, error: "Complete rejected." }, { status: 409 });
    }

    const stored = await getStoredPatchKit(job.cleanupRunId);
    if (stored?.payload) {
      const patchValidation = body.result.patchValidation ?? stored.payload.patchValidation;
      const repositoryVerification =
        body.result.repositoryVerification ?? stored.payload.repositoryVerification;
      const verifiedOps =
        repositoryVerification?.status === "verified"
          ? stored.payload.summary.validatedChanges ?? 0
          : 0;

      const payload = {
        ...stored.payload,
        patchValidation,
        repositoryVerification,
        workerJobId: job.id,
        summary: {
          ...stored.payload.summary,
          patchValidationStatus: patchValidation?.status,
          verifiedChanges: verifiedOps,
          verifiedFileOperations: verifiedOps,
        },
      };
      await storePatchKit(payload, stored.zipBuffer, stored.filename, stored.scanId);
    }

    return NextResponse.json({ ok: true, job });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Complete failed.";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message.includes("Unauthorized") ? 401 : 500 }
    );
  }
}
