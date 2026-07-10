import { NextResponse } from "next/server";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { jobOwnerKey } from "@/lib/jobs/types";
import { getStoredFindings } from "@/lib/findings/findings-store";
import { createPatchJob, runPatchJob } from "@/lib/jobs/run-patch-job";
import type { FindingsPayload } from "@/lib/findings/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Generate a review-ready patch bundle from persisted findings. */
export async function POST(request: Request) {
  try {
    const ownerKey = jobOwnerKey(request);
    enforceRateLimit(ownerKey, "patch");

    const body = (await request.json()) as {
      scanId?: string;
      selectedFindingIds?: string[];
      repoUrl?: string;
      branch?: string;
      findings?: FindingsPayload;
    };

    let findings = body.findings;
    if (!findings && body.scanId) {
      findings = getStoredFindings(body.scanId);
    }

    if (!findings) {
      return NextResponse.json(
        { success: false, error: "Findings not found. Run analysis first." },
        { status: 404 }
      );
    }

    if (body.selectedFindingIds?.length) {
      const selected = new Set(body.selectedFindingIds);
      const filterList = <T extends { id: string }>(items: T[]) =>
        items.filter((item) => selected.has(item.id));
      findings = {
        ...findings,
        duplicates: filterList(findings.duplicates),
        unused: {
          files: filterList(findings.unused.files),
          dependencies: filterList(findings.unused.dependencies),
          exports: filterList(findings.unused.exports),
        },
        orphans: filterList(findings.orphans),
        slopSignals: filterList(findings.slopSignals),
      };
    }

    const repoUrl =
      body.repoUrl?.trim() ||
      `https://github.com/${findings.repo.owner}/${findings.repo.name}`;

    const job = createPatchJob(repoUrl, body.branch ?? findings.repo.branch, ownerKey, findings);
    const completed = await runPatchJob(job.id, findings);

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
        { success: false, error: err.message },
        { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } }
      );
    }
    const message = err instanceof Error ? err.message : "Patch generation failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
