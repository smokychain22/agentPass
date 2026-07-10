import { NextResponse } from "next/server";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { jobOwnerKey } from "@/lib/jobs/types";
import { getStoredFindings } from "@/lib/findings/findings-store";
import { createPatchJob, runPatchJob } from "@/lib/jobs/run-patch-job";
import { filterFindingsBySelection } from "@/lib/patch-kit/filter-findings";
import { isDemoRepoUrl } from "@/lib/demo/constants";
import { enforcePayment } from "@/lib/payment/x402";
import type { FindingsPayload } from "@/lib/findings/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Generate a review-ready patch bundle from persisted findings. */
export async function POST(request: Request) {
  try {
    const ownerKey = jobOwnerKey(request);
    const body = (await request.json()) as {
      scanId?: string;
      selectedFindingIds?: string[];
      repoUrl?: string;
      branch?: string;
      findings?: FindingsPayload;
      idempotencyKey?: string;
    };

    await enforceRateLimit(ownerKey, "patch:paid", {
      scopeKey: body.scanId ?? body.idempotencyKey,
    });

    let findings = body.findings;
    if (!findings && body.scanId) {
      findings = await getStoredFindings(body.scanId);
    }

    if (!findings) {
      return NextResponse.json(
        { success: false, error: "Findings not found. Run analysis first." },
        { status: 404 }
      );
    }

    const repoUrl =
      body.repoUrl?.trim() ||
      `https://github.com/${findings.repo.owner}/${findings.repo.name}`;

    enforcePayment(request, "patch_bundle", { free: isDemoRepoUrl(repoUrl) });

    const filtered = filterFindingsBySelection(findings, body.selectedFindingIds);

    const job = await createPatchJob(repoUrl, body.branch ?? filtered.repo.branch, ownerKey, filtered);
    const completed = await runPatchJob(job.id, filtered, body.selectedFindingIds);

    if (completed.status === "failed") {
      return NextResponse.json(
        { success: false, error: completed.error ?? "Patch generation failed." },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      patchId: completed.result?.id,
      patchKit: completed.result,
      patchValidation: completed.patchValidation,
    });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { success: false, error: err.message, rateLimit: err.toJSON() },
        { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } }
      );
    }
    const paymentErr = err as Error & { status?: number; body?: unknown };
    if (paymentErr.status === 402) {
      return NextResponse.json(paymentErr.body, { status: 402 });
    }
    const message = err instanceof Error ? err.message : "Patch generation failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
