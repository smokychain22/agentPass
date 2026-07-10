import { NextResponse } from "next/server";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { rateLimitJsonResponse } from "@/lib/api/rate-limit-response";
import { jobOwnerKey } from "@/lib/jobs/types";
import { createPatchJob, runPatchJob } from "@/lib/jobs/run-patch-job";
import { getStoredFindings } from "@/lib/findings/findings-store";
import { isDemoRepoUrl } from "@/lib/demo/constants";
import { enforcePayment } from "@/lib/payment/x402";
import { getJob } from "@/lib/jobs/job-store";
import type { PatchJob } from "@/lib/jobs/types";
import type { FindingsPayload } from "@/lib/findings/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const ownerKey = jobOwnerKey(request);
    const body = (await request.json()) as {
      repoUrl?: string;
      branch?: string;
      scanId?: string;
      findings?: FindingsPayload;
      selectedFindingIds?: string[];
      idempotencyKey?: string;
    };

    const rateScope = body.scanId ?? body.findings?.scanId ?? body.idempotencyKey;
    await enforceRateLimit(ownerKey, "patch", { scopeKey: rateScope });

    if (!body.repoUrl?.trim() && !body.scanId && !body.findings?.scanId) {
      return NextResponse.json(
        { success: false, error: "repoUrl or scanId is required." },
        { status: 422 }
      );
    }

    let findings = body.findings;
    if (!findings && body.scanId) {
      findings = await getStoredFindings(body.scanId);
      if (!findings) {
        return NextResponse.json(
          { success: false, error: "Findings not found for scanId." },
          { status: 404 }
        );
      }
    }

    const repoUrl =
      body.repoUrl?.trim() ||
      (findings ? `https://github.com/${findings.repo.owner}/${findings.repo.name}` : "");
    const branch = body.branch?.trim() || findings?.repo.branch;

    enforcePayment(request, "patch_bundle", { free: isDemoRepoUrl(repoUrl) });

    const job = await createPatchJob(repoUrl, branch, ownerKey, findings);
    await runPatchJob(job.id, findings, body.selectedFindingIds);

    const completed = (await getJob(job.id)) as PatchJob | undefined;
    if (!completed) {
      return NextResponse.json({ success: false, error: "Job completed but not retrievable." }, { status: 500 });
    }

    return NextResponse.json({
      success: completed.status !== "failed",
      jobId: completed.id,
      status: completed.status,
      stage: completed.stage,
      progress: completed.progress,
      isDemo: completed.isDemo,
      patchValidation: completed.patchValidation,
      result: completed.status === "complete" ? completed.result : undefined,
      error: completed.error,
    });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return rateLimitJsonResponse(err);
    }
    const paymentErr = err as Error & { status?: number; body?: unknown };
    if (paymentErr.status === 402) {
      return NextResponse.json(paymentErr.body, { status: 402 });
    }
    const message = err instanceof Error ? err.message : "Failed to create patch job.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
