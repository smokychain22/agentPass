import { NextResponse } from "next/server";
import { getStoredFindings } from "@/lib/findings/findings-store";
import { flattenFindings } from "@/lib/findings/client";
import { riskBucketOf } from "@/lib/findings/cleanup-eligibility";
import { saveFindingDecision } from "@/lib/user-directed/decision-store";
import { appendVerificationRecord } from "@/lib/user-directed/verification-store";
import { runBoundedReferenceVerification } from "@/lib/execution/verification-pipeline";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Command 3E, Part 3/6 — runs one real, bounded automated verification
 * check against the actual repository content and persists the result.
 * Transitions the finding's decision from "verification_requested" to
 * either "verified_selected" (READY TO FIX) or "verified_kept" (LEAVE
 * UNCHANGED) based on the real outcome — never left stuck mid-flight, and
 * never a fabricated pass.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { scanId?: string; findingId?: string };
  if (!body.scanId || !body.findingId) {
    return NextResponse.json(
      { ok: false, error: "scanId and findingId are required." },
      { status: 400 }
    );
  }

  const findingsPayload = await getStoredFindings(body.scanId);
  if (!findingsPayload) {
    return NextResponse.json(
      { ok: false, error: "Findings not found for scanId — the scan is stale or unknown." },
      { status: 404 }
    );
  }

  const finding = flattenFindings(findingsPayload).find((f) => f.id === body.findingId);
  if (!finding) {
    return NextResponse.json(
      { ok: false, error: "This finding is not present in the stored findings for this scan." },
      { status: 404 }
    );
  }

  if (riskBucketOf(finding) === "PROTECTED") {
    return NextResponse.json(
      { ok: false, error: "Protected findings cannot be verified for removal." },
      { status: 403 }
    );
  }
  if (finding.detectionType && !finding.supportedTransformationId) {
    return NextResponse.json(
      {
        ok: false,
        error: "RepoDiet has no implemented transformation for this finding — nothing to verify.",
      },
      { status: 403 }
    );
  }

  await saveFindingDecision({
    scanId: body.scanId,
    findingId: body.findingId,
    decision: "verification_requested",
    analyzedCommit: findingsPayload.repo.commitSha,
  });

  const repoUrl =
    findingsPayload.repo.url || `https://github.com/${findingsPayload.repo.owner}/${findingsPayload.repo.name}`;

  let workspace;
  try {
    workspace = await prepareRepoWorkspace(
      repoUrl,
      findingsPayload.repo.branch,
      undefined,
      findingsPayload.repo.commitSha
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not prepare a workspace to verify this finding.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  try {
    const outcome = await runBoundedReferenceVerification(finding, workspace);
    await appendVerificationRecord({
      ...outcome,
      scanId: body.scanId,
      findingId: body.findingId,
      commitSha: findingsPayload.repo.commitSha,
    });

    const finalDecision = outcome.result === "passed" ? "verified_selected" : "verified_kept";
    const decision = await saveFindingDecision({
      scanId: body.scanId,
      findingId: body.findingId,
      decision: finalDecision,
      analyzedCommit: findingsPayload.repo.commitSha,
      filesToRemove: finalDecision === "verified_selected" ? finding.files : undefined,
      filesToKeep: finalDecision === "verified_kept" ? finding.files : undefined,
      verificationStatus: outcome.result === "passed" ? "verified" : "failed",
    });

    return NextResponse.json({ ok: true, verification: outcome, decision });
  } finally {
    await workspace.cleanup();
  }
}
