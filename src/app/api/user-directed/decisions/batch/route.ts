import { NextResponse } from "next/server";
import { getStoredFindings } from "@/lib/findings/findings-store";
import { flattenFindings } from "@/lib/findings/client";
import { isCleanupEligible } from "@/lib/findings/cleanup-eligibility";
import {
  clearFindingDecision,
  listFindingDecisions,
  saveFindingDecision,
} from "@/lib/user-directed/decision-store";

export const runtime = "nodejs";
export const maxDuration = 60;

interface PerFindingOutcome {
  findingId: string;
  ok: boolean;
  error?: string;
}

/**
 * Batch decision mutations. Never claims blanket success — always returns
 * the exact per-finding outcome so the UI can never report a fix as
 * selected when its own persistence actually failed.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    scanId?: string;
    action?: "select_recommended" | "clear_selected";
  };

  if (!body.scanId) {
    return NextResponse.json({ ok: false, error: "scanId is required." }, { status: 400 });
  }

  if (body.action === "select_recommended") {
    const findingsPayload = await getStoredFindings(body.scanId);
    if (!findingsPayload) {
      return NextResponse.json({ ok: false, error: "Findings not found for scanId." }, { status: 404 });
    }
    const existing = await listFindingDecisions(body.scanId);
    const decided = new Set(existing.map((d) => d.findingId));
    const recommended = flattenFindings(findingsPayload).filter(
      (f) => isCleanupEligible(f) && !decided.has(f.id)
    );

    const outcomes: PerFindingOutcome[] = [];
    for (const finding of recommended) {
      try {
        await saveFindingDecision({
          scanId: body.scanId,
          findingId: finding.id,
          decision: "selected",
          analyzedCommit: findingsPayload.repo.commitSha,
          filesToRemove: finding.files,
        });
        outcomes.push({ findingId: finding.id, ok: true });
      } catch (err) {
        outcomes.push({
          findingId: finding.id,
          ok: false,
          error: err instanceof Error ? err.message : "Failed to persist decision.",
        });
      }
    }

    return NextResponse.json({
      ok: outcomes.every((o) => o.ok),
      action: "select_recommended",
      attempted: outcomes.length,
      succeeded: outcomes.filter((o) => o.ok).length,
      outcomes,
    });
  }

  if (body.action === "clear_selected") {
    const existing = await listFindingDecisions(body.scanId);
    // Only clear decisions that actually enter the cleanup plan — "kept"
    // and "excluded" decisions the user intentionally made are preserved.
    const toClear = existing.filter(
      (d) => d.decision === "selected" || d.decision === "verified_selected"
    );

    const outcomes: PerFindingOutcome[] = [];
    for (const d of toClear) {
      try {
        await clearFindingDecision(body.scanId, d.findingId);
        outcomes.push({ findingId: d.findingId, ok: true });
      } catch (err) {
        outcomes.push({
          findingId: d.findingId,
          ok: false,
          error: err instanceof Error ? err.message : "Failed to clear decision.",
        });
      }
    }

    return NextResponse.json({
      ok: outcomes.every((o) => o.ok),
      action: "clear_selected",
      attempted: outcomes.length,
      succeeded: outcomes.filter((o) => o.ok).length,
      outcomes,
    });
  }

  return NextResponse.json({ ok: false, error: "Unknown batch action." }, { status: 400 });
}
