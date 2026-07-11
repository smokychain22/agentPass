import { NextResponse } from "next/server";
import { completeRepositoryJob, getRepositoryJob } from "@/lib/worker/repository-job-store";
import { assertWorkerAuthorized, validateWorkerCallbackSecret } from "@/lib/worker/worker-auth";
import { getStoredPatchKit, storePatchKit } from "@/lib/patch-kit/patch-kit-store";
import { buildCleanupRunSummary } from "@/lib/patch-kit/cleanup-summary";
import type { RepositoryJobResult, RepositoryJobStatus } from "@/lib/worker/types";
import { setWorkerStatus } from "@/lib/worker/worker-instance-store";

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
      const cleanupRunSummary = buildCleanupRunSummary({
        findings: stored.payload.artifacts.findingsJson!,
        summary: stored.payload.summary,
        candidateAudits: stored.payload.candidateAudits,
        changeOperations: stored.payload.changeOperations,
        verification: repositoryVerification as import("@/lib/patch-kit/repository-verification").RepositoryVerificationResult | null,
        pullRequestUrl: stored.payload.summary.blockerSummary?.includes("github.com")
          ? stored.payload.summary.blockerSummary
          : undefined,
      });

      const payload = {
        ...stored.payload,
        patchValidation,
        repositoryVerification,
        workerJobId: job.id,
        cleanupRunSummary,
        summary: {
          ...stored.payload.summary,
          patchValidationStatus: patchValidation?.status,
          generatedChanges: cleanupRunSummary.generatedOperations,
          generatedFileOperations: cleanupRunSummary.generatedOperations,
          contentValidatedOperations: cleanupRunSummary.contentValidatedOperations,
          gitValidatedOperations: cleanupRunSummary.gitValidatedOperations,
          validatedChanges: cleanupRunSummary.gitValidatedOperations,
          validatedFileOperations: cleanupRunSummary.gitValidatedOperations,
          verifiedChanges: cleanupRunSummary.verifiedOperations,
          verifiedFileOperations: cleanupRunSummary.verifiedOperations,
          deliveredFileOperations: cleanupRunSummary.deliveredOperations,
          executedFindings: cleanupRunSummary.executedFindings,
          eligibleFindings: cleanupRunSummary.eligibleFindings,
          detectedFindings: cleanupRunSummary.detectedFindings,
          blockerSummary:
            repositoryVerification?.status === "verified"
              ? `${cleanupRunSummary.verifiedOperations} verified file operation(s) ready for cleanup PR.`
              : stored.payload.summary.blockerSummary,
        },
      };
      await storePatchKit(payload, stored.zipBuffer, stored.filename, stored.scanId);
    }

    await setWorkerStatus(workerId, "online");

    return NextResponse.json({ ok: true, job });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Complete failed.";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message.includes("Unauthorized") ? 401 : 500 }
    );
  }
}
