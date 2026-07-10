import { EMPTY_CLEANUP_PATCH } from "./generate-cleanup-patch";
import { extractApplyablePatch } from "./validate-patch";

/** Concatenate unified diff sections from multiple patch sources. */
export function mergeCleanupPatches(...patches: string[]): string {
  const sections: string[] = [];

  for (const patch of patches) {
    const trimmed = patch.trim();
    if (!trimmed || trimmed === EMPTY_CLEANUP_PATCH.trim()) continue;
    const applyable = extractApplyablePatch(trimmed);
    if (applyable.trim()) sections.push(applyable.trim());
  }

  if (sections.length === 0) return EMPTY_CLEANUP_PATCH;
  return sections.join("\n\n");
}
