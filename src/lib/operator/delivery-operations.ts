import type { PatchKitPayload } from "@/lib/patch-kit/types";
import { filterOperatorSafeDeletes } from "./safety";

export interface ValidatedDeliveryOps {
  contentEdits: Array<{ path: string; content: string; baselineContentHash?: string }>;
  deletePaths: string[];
  skippedDeletePaths: string[];
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((p) => p.replace(/\\/g, "/").replace(/^\.\//, "")).filter(Boolean))];
}

/** Authoritative delete paths from patch-kit outputs (never upsert empty content). */
export function resolveValidatedDeliveryOps(
  patchKit: PatchKitPayload,
  validatedEdits: Array<{ path: string; content: string; baselineContentHash?: string }> = []
): ValidatedDeliveryOps {
  const fromOps =
    patchKit.changeOperations?.filter((op) => op.type === "delete").map((op) => op.filePath) ?? [];
  const fromSummary = patchKit.summary.deletedPaths ?? [];
  const fromEmptyEdits = validatedEdits.filter((e) => e.content === "").map((e) => e.path);

  const candidateDeletes = uniquePaths([...fromSummary, ...fromOps, ...fromEmptyEdits]);
  const deletePaths = filterOperatorSafeDeletes(candidateDeletes);
  const allowed = new Set(deletePaths);
  const skippedDeletePaths = candidateDeletes.filter((p) => !allowed.has(p));

  const contentEdits = validatedEdits.filter((e) => e.content !== "");

  return { contentEdits, deletePaths, skippedDeletePaths };
}
