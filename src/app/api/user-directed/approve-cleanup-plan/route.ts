import { NextResponse } from "next/server";
import { approvePlan } from "@/lib/user-directed/cleanup-plan-store";
import { computeDecisionsFingerprint, listFindingDecisions } from "@/lib/user-directed/decision-store";
import { getStoredFindings } from "@/lib/findings/findings-store";
import { flattenFindings } from "@/lib/findings/client";
import { riskBucketOf } from "@/lib/findings/cleanup-eligibility";

export const runtime = "nodejs";
export const maxDuration = 30;

/** User has reviewed the plan and approved it. Idempotent — approving twice for the same selection is a no-op. */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    scanId?: string;
    pinnedCommit?: string;
    includeFindingIds?: string[];
  };

  if (!body.scanId || !body.pinnedCommit) {
    return NextResponse.json(
      { ok: false, error: "scanId and pinnedCommit are required." },
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
  if (findingsPayload.repo.commitSha && findingsPayload.repo.commitSha !== body.pinnedCommit) {
    return NextResponse.json(
      { ok: false, error: "The pinned commit no longer matches this scan's findings." },
      { status: 409 }
    );
  }

  const includeFindingIds = body.includeFindingIds ?? [];
  if (includeFindingIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: "At least one selected cleanup action is required to approve a plan." },
      { status: 400 }
    );
  }

  const allFindings = flattenFindings(findingsPayload);
  const byId = new Map(allFindings.map((f) => [f.id, f]));
  for (const findingId of includeFindingIds) {
    const finding = byId.get(findingId);
    if (!finding) {
      return NextResponse.json(
        { ok: false, error: `Finding ${findingId} is not present in this scan's stored findings.` },
        { status: 404 }
      );
    }
    if (riskBucketOf(finding) === "PROTECTED") {
      return NextResponse.json(
        {
          ok: false,
          error: `Finding ${findingId} is protected — RepoDiet will not modify it directly, so it cannot be part of an approved plan.`,
        },
        { status: 403 }
      );
    }
    // Command 3E, Part 8: a plan can only include findings with a real,
    // implemented transformation. Findings persisted before the detection/
    // resolution split (no detectionType) fall back to the check above only.
    if (finding.detectionType && !finding.supportedTransformationId) {
      return NextResponse.json(
        {
          ok: false,
          error: `Finding ${findingId} has no implemented transformation — it cannot be part of an approved plan.`,
        },
        { status: 403 }
      );
    }
  }

  const currentDecisions = await listFindingDecisions(body.scanId);
  const incomplete = currentDecisions.filter((d) => d.decision === "verification_requested");
  if (incomplete.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `${incomplete.length} selected fix(es) still need a choice before this plan can be approved.`,
      },
      { status: 409 }
    );
  }

  try {
    const decisionsFingerprint = computeDecisionsFingerprint(currentDecisions);
    const plan = await approvePlan({
      scanId: body.scanId,
      pinnedCommit: body.pinnedCommit,
      includedFindingIds: includeFindingIds,
      decisionsFingerprint,
    });
    return NextResponse.json({ ok: true, plan });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not approve cleanup plan.";
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
}
