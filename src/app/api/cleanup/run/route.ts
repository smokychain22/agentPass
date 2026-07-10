import { NextResponse } from "next/server";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { jobOwnerKey } from "@/lib/jobs/types";
import { getStoredFindings } from "@/lib/findings/findings-store";
import { runFreeCleanupCore } from "@/lib/execution/run-cleanup-core";
import { signExecutionReceipt } from "@/lib/operator/sign-receipt";
import { FREE_CLEANUP_LIMIT, isAutoFixEligible } from "@/lib/cleanup/eligibility";
import type { FindingsPayload } from "@/lib/findings/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const ownerKey = jobOwnerKey(request);
    await enforceRateLimit(ownerKey, "patch");

    const body = (await request.json()) as {
      scanId?: string;
      findings?: FindingsPayload;
      findingIds?: string[];
    };

    let findings = body.findings;
    if (!findings && body.scanId) {
      findings = await getStoredFindings(body.scanId);
    }

    if (!findings) {
      return NextResponse.json({ success: false, error: "Findings not found." }, { status: 404 });
    }

    if (body.findingIds && body.findingIds.length > FREE_CLEANUP_LIMIT) {
      return NextResponse.json(
        { success: false, error: `Maximum ${FREE_CLEANUP_LIMIT} findings per free cleanup run.` },
        { status: 422 }
      );
    }

    if (body.findingIds?.length) {
      const all = [
        ...findings.duplicates,
        ...findings.unused.files,
        ...findings.unused.dependencies,
        ...findings.unused.exports,
        ...findings.orphans,
        ...findings.slopSignals,
      ];
      const picked = all.filter((f) => body.findingIds!.includes(f.id));
      const invalid = picked.filter((f) => !isAutoFixEligible(f) && f.action === "do_not_touch");
      if (invalid.length > 0) {
        return NextResponse.json(
          { success: false, error: "Protected findings cannot be included in free cleanup." },
          { status: 422 }
        );
      }
    }

    const result = await runFreeCleanupCore(findings, { findingIds: body.findingIds });

    const signedReceipt = signExecutionReceipt(result.receipt);

    return NextResponse.json({ success: true, cleanup: result, signedReceipt });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } }
      );
    }
    const message = err instanceof Error ? err.message : "Free cleanup failed.";
    return NextResponse.json({ success: false, error: message }, { status: 422 });
  }
}
