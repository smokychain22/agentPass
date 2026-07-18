import { createHash } from "node:crypto";
import type { RequestedAction, TransformationPlan } from "./types";
import { normalizeTrackedPath } from "./path-identity";

export function stableJsonHash(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
  }
  return value;
}

export function hashScope(input: {
  repository: string;
  pinnedCommit: string;
  selectedPaths: string[];
  selectedFindingIds: string[];
  requestedActions: RequestedAction[];
}): string {
  return stableJsonHash({
    repository: input.repository,
    pinnedCommit: input.pinnedCommit,
    selectedPaths: [...input.selectedPaths].map(normalizeTrackedPath).sort(),
    selectedFindingIds: [...input.selectedFindingIds].sort(),
    requestedActions: input.requestedActions.map((a) => ({
      actionType: a.actionType,
      pathIds: [...a.pathIds].sort(),
      findingIds: [...a.findingIds].sort(),
      userInstruction: a.userInstruction ?? "",
      targetPath: a.targetPath ?? "",
      canonicalPath: a.canonicalPath ?? "",
    })),
  });
}

export function hashTransformationPlan(plan: Omit<TransformationPlan, "planHash">): string {
  return stableJsonHash({
    repository: plan.repository,
    pinnedCommit: plan.pinnedCommit,
    selectedRepositoryPaths: [...plan.selectedRepositoryPaths].map(normalizeTrackedPath).sort(),
    selectedFindingIds: [...plan.selectedFindingIds].sort(),
    status: plan.status,
    executable: plan.executable,
    proposedAction: plan.proposedAction,
    transformerId: plan.transformerId ?? "",
    fileChanges: plan.fileChanges,
    unifiedDiff: plan.unifiedDiff ?? "",
    normalizedPatchHash: plan.normalizedPatchHash ?? "",
    validationCommands: plan.validationCommands,
    unexpectedChangeBudget: plan.unexpectedChangeBudget,
  });
}

export function hashNormalizedPatch(unifiedDiff: string): string {
  return createHash("sha256").update(unifiedDiff.replace(/\r\n/g, "\n")).digest("hex");
}
