import { NextResponse } from "next/server";
import { getStoredFindings } from "@/lib/findings/findings-store";
import { flattenFindings } from "@/lib/findings/client";
import { prepareAutomaticCleanupPlan } from "@/lib/user-directed/auto-cleanup-plan";
import { partitionPlans } from "@/lib/user-directed/partition-plans";
import { buildScanOutcomeSummary } from "@/lib/user-directed/scan-outcome-summary";
import { saveDraftPlan } from "@/lib/user-directed/cleanup-plan-store";
import { computeDecisionsFingerprint, listFindingDecisions } from "@/lib/user-directed/decision-store";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Automatic Cleanup — build a combined plan from evidence-backed findings.
 * User may exclude items; they do not select transformers.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      repository?: string;
      pinnedCommit?: string;
      scanId?: string;
      includeFindingIds?: string[];
      excludeFindingIds?: string[];
      requestedBy?: string;
    };

    if (!body.scanId) {
      return NextResponse.json({ ok: false, error: "scanId is required." }, { status: 400 });
    }

    const findingsPayload = await getStoredFindings(body.scanId);
    if (!findingsPayload) {
      return NextResponse.json({ ok: false, error: "Findings not found for scanId." }, { status: 404 });
    }

    const repository =
      body.repository ||
      `${findingsPayload.repo.owner}/${findingsPayload.repo.name}`;
    const pinnedCommit = body.pinnedCommit || findingsPayload.repo.commitSha || "";
    if (!pinnedCommit) {
      return NextResponse.json(
        { ok: false, error: "pinnedCommit is required (scan missing commit SHA)." },
        { status: 400 }
      );
    }

    const flat = flattenFindings(findingsPayload);
    const outcome = buildScanOutcomeSummary(findingsPayload);
    const prepared = prepareAutomaticCleanupPlan({
      repository,
      pinnedCommit,
      findings: flat,
      includeFindingIds: body.includeFindingIds,
      excludeFindingIds: body.excludeFindingIds,
      requestedBy: body.requestedBy ?? "automatic_cleanup",
    });

    const parts = partitionPlans(prepared.plans);

    const currentDecisions = await listFindingDecisions(body.scanId);
    const decisionsFingerprint = computeDecisionsFingerprint(currentDecisions);

    const planState = await saveDraftPlan({
      scanId: body.scanId,
      pinnedCommit,
      includedFindingIds: prepared.includedFindingIds,
      excludedFindingIds: prepared.excludedFindingIds,
      decisionsFingerprint,
    });

    return NextResponse.json({
      ok: true,
      mode: "AUTOMATIC_CLEANUP",
      outcome,
      summary: prepared.summary,
      transformationPlans: prepared.plans,
      includedFindingIds: prepared.includedFindingIds,
      excludedFindingIds: prepared.excludedFindingIds,
      cleanupEligiblePlans: parts.cleanupEligiblePlans,
      blockedPlans: parts.blockedPlans,
      selectionSeparatedFromEligibility: true,
      userChoosesOutcome: true,
      transformerSelectionRequired: false,
      planStatus: planState.status,
      decisionsFingerprint,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Prepare cleanup plan failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
