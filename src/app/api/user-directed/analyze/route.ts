import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getStoredFindings } from "@/lib/findings/findings-store";
import { flattenFindings } from "@/lib/findings/client";
import { analyzeRequestedAction } from "@/lib/user-directed/analyze-requested-action";
import { partitionPlans } from "@/lib/user-directed/partition-plans";
import { pathIdFor, normalizeTrackedPath } from "@/lib/user-directed/path-identity";
import type {
  RequestedAction,
  RequestedActionType,
  TransformationPlan,
} from "@/lib/user-directed/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Analyze user-directed requests into TransformationPlans.
 * Does not create a payable quote (requires exact patch via plan preview).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      repository: string;
      pinnedCommit: string;
      scanId?: string;
      selectedRepositoryPaths?: string[];
      selectedFindingIds?: string[];
      actionType?: RequestedActionType;
      userInstruction?: string;
      canonicalPath?: string;
      targetPath?: string;
      requestedBy?: string;
      /** Optional preflight unified diff — required for executable PLAN_READY */
      unifiedDiff?: string;
      transformerAvailable?: boolean;
    };

    if (!body.repository || !body.pinnedCommit) {
      return NextResponse.json(
        { ok: false, error: "repository and pinnedCommit are required." },
        { status: 400 }
      );
    }

    const paths = (body.selectedRepositoryPaths ?? []).map(normalizeTrackedPath);
    const findingIds = body.selectedFindingIds ?? [];
    if (paths.length === 0 && findingIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Select at least one repository path or finding." },
        { status: 400 }
      );
    }

    let findings = body.scanId ? await getStoredFindings(body.scanId) : null;
    const flat = findings ? flattenFindings(findings) : [];

    // Expand finding IDs into paths when paths omitted.
    const fromFindings = flat
      .filter((f) => findingIds.includes(f.id))
      .flatMap((f) => f.files.map(normalizeTrackedPath));
    const allPaths = [...new Set([...paths, ...fromFindings])];

    const action: RequestedAction = {
      id: `req_${nanoid(10)}`,
      repository: body.repository,
      pinnedCommit: body.pinnedCommit,
      pathIds: allPaths.map(pathIdFor),
      findingIds,
      actionType: body.actionType ?? "DELETE",
      userInstruction: body.userInstruction,
      canonicalPath: body.canonicalPath,
      targetPath: body.targetPath,
      requestedAt: new Date().toISOString(),
      requestedBy: body.requestedBy ?? "workspace_user",
    };

    const plan: TransformationPlan = analyzeRequestedAction({
      action,
      findings: flat,
      unifiedDiff: body.unifiedDiff,
      transformerAvailable: body.transformerAvailable,
    });

    const parts = partitionPlans([plan]);

    return NextResponse.json({
      ok: true,
      requestedAction: action,
      transformationPlans: [plan],
      cleanupEligiblePlans: parts.cleanupEligiblePlans,
      blockedPlans: parts.blockedPlans,
      selectionSeparatedFromEligibility: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analyze failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
