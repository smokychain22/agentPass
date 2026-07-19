import { nanoid } from "nanoid";
import type { Finding } from "@/lib/findings/types";
import { isCleanupEligible } from "@/lib/findings/cleanup-eligibility";
import { analyzeRequestedAction } from "./analyze-requested-action";
import { pathIdFor, normalizeTrackedPath } from "./path-identity";
import { recommendedActionForFinding } from "./recommended-action";
import type { RequestedAction, TransformationPlan } from "./types";

export interface PrepareAutomaticCleanupInput {
  repository: string;
  pinnedCommit: string;
  findings: Finding[];
  /** When set, only these eligible IDs are included (user exclusions). */
  includeFindingIds?: string[];
  /** Finding IDs explicitly excluded by the user. */
  excludeFindingIds?: string[];
  requestedBy?: string;
}

export interface AutomaticCleanupPlanResult {
  plans: TransformationPlan[];
  includedFindingIds: string[];
  excludedFindingIds: string[];
  summary: {
    deleteCount: number;
    consolidateCount: number;
    referenceUpdateCount: number;
    editCount: number;
    validationCommands: string[];
  };
}

/**
 * Build one combined cleanup plan from evidence-backed findings.
 * User may exclude items; they do not pick transformers.
 */
export function prepareAutomaticCleanupPlan(
  input: PrepareAutomaticCleanupInput
): AutomaticCleanupPlanResult {
  const exclude = new Set(input.excludeFindingIds ?? []);
  let eligible = input.findings.filter(isCleanupEligible).filter((f) => !exclude.has(f.id));

  if (input.includeFindingIds?.length) {
    const include = new Set(input.includeFindingIds);
    eligible = eligible.filter((f) => include.has(f.id));
  }

  const plans: TransformationPlan[] = [];
  const includedFindingIds: string[] = [];

  for (const finding of eligible) {
    const paths = finding.files.map(normalizeTrackedPath).filter(Boolean);
    if (paths.length === 0 && finding.type !== "unused_dependency") continue;

    const actionType = recommendedActionForFinding(finding);
    const action: RequestedAction = {
      id: `req_${nanoid(10)}`,
      repository: input.repository,
      pinnedCommit: input.pinnedCommit,
      pathIds: paths.map(pathIdFor),
      findingIds: [finding.id],
      actionType,
      userInstruction: `Automatic cleanup: ${actionType} for ${finding.id}`,
      requestedAt: new Date().toISOString(),
      requestedBy: input.requestedBy ?? "automatic_cleanup",
    };

    const plan = analyzeRequestedAction({
      action,
      findings: input.findings,
      transformerAvailable: true,
    });
    plans.push(plan);
    includedFindingIds.push(finding.id);
  }

  const validationCommands = [
    ...new Set(plans.flatMap((p) => p.validationCommands)),
  ];
  if (validationCommands.length === 0) {
    validationCommands.push("npm run typecheck", "npm test");
  }

  return {
    plans,
    includedFindingIds,
    excludedFindingIds: [...exclude],
    summary: {
      deleteCount: plans.filter((p) => p.proposedAction === "DELETE").length,
      consolidateCount: plans.filter((p) => p.proposedAction === "CONSOLIDATE_DUPLICATES")
        .length,
      referenceUpdateCount: plans.filter((p) => p.proposedAction === "UPDATE_REFERENCES")
        .length,
      editCount: plans.filter((p) => p.proposedAction === "EDIT").length,
      validationCommands,
    },
  };
}
