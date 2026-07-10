import { NextResponse } from "next/server";
import { after } from "next/server";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { jobOwnerKey } from "@/lib/jobs/types";
import { createPatchJob, runPatchJob } from "@/lib/jobs/run-patch-job";
import { getStoredFindings } from "@/lib/findings/findings-store";
import { isDemoRepoUrl } from "@/lib/demo/constants";
import { enforcePayment } from "@/lib/payment/x402";
import type { FindingsPayload } from "@/lib/findings/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const ownerKey = jobOwnerKey(request);
    enforceRateLimit(ownerKey, "patch");

    const body = (await request.json()) as {
      repoUrl?: string;
      branch?: string;
      scanId?: string;
      findings?: FindingsPayload;
      selectedFindingIds?: string[];
    };

    if (!body.repoUrl?.trim() && !body.scanId && !body.findings?.scanId) {
      return NextResponse.json(
        { success: false, error: "repoUrl or scanId is required." },
        { status: 422 }
      );
    }

    let findings = body.findings;
    if (!findings && body.scanId) {
      findings = getStoredFindings(body.scanId);
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

    const job = createPatchJob(repoUrl, branch, ownerKey, findings);
    const selectedFindingIds = body.selectedFindingIds;

    after(async () => {
      await runPatchJob(job.id, findings, selectedFindingIds);
    });

    return NextResponse.json({ success: true, jobId: job.id, status: job.status });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } }
      );
    }
    const paymentErr = err as Error & { status?: number; body?: unknown };
    if (paymentErr.status === 402) {
      return NextResponse.json(paymentErr.body, { status: 402 });
    }
    const message = err instanceof Error ? err.message : "Failed to create patch job.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
