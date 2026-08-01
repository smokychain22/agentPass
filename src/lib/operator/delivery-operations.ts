import type { PatchKitPayload } from "@/lib/patch-kit/types";
import { ToolExecutionError } from "@/lib/a2mcp/errors";
import {
  filterOperatorSafeDeletes,
  isApprovedValidatedDeletePath,
  normalizePath,
} from "./safety";

export interface ValidatedDeliveryOps {
  contentEdits: Array<{ path: string; content: string; baselineContentHash?: string }>;
  deletePaths: string[];
  skippedDeletePaths: string[];
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((p) => p.replace(/\\/g, "/").replace(/^\.\//, "")).filter(Boolean))];
}

function isAbsolutePath(rawEntry: string): boolean {
  return /^\//.test(rawEntry) || /^[A-Za-z]:[\\/]/.test(rawEntry);
}

function containsTraversalSegment(normalized: string): boolean {
  return normalized.split("/").some((segment) => segment === "..");
}

/**
 * Turns caller-supplied delete-path approval into a safe, deduped list of
 * repository-relative paths — the single place every caller of
 * `resolveValidatedDeliveryOps` should route explicit approval through, so
 * a future caller cannot recreate a weaker parallel check.
 *
 * Absolute paths and traversal segments are rejected outright (400) rather
 * than silently dropped: a caller supplying `/etc/passwd` or `../../x` is
 * either a bug or an attempt to reach outside the repository, and both
 * deserve a loud failure, not quiet exclusion from the approved set.
 *
 * A caller that explicitly supplies a non-empty array which normalizes to
 * nothing (e.g. `["   "]`) also fails loudly, for the same reason
 * `selectedFindingIds` normalizing to nothing must fail rather than
 * silently falling through to "no selection" behavior elsewhere in this
 * delivery path.
 *
 * Omitting `approvedPaths` entirely (or passing `[]`) is unaffected — that
 * remains "no explicit approval requested" and preserves every existing
 * operator-safe-default delete.
 */
export function normalizeApprovedPaths(raw: string[] | undefined): string[] {
  if (!raw || raw.length === 0) return [];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      throw new ToolExecutionError("INVALID_INPUT", "approvedPaths entries must be strings.", 400);
    }
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (isAbsolutePath(trimmed)) {
      throw new ToolExecutionError(
        "INVALID_INPUT",
        `approvedPaths must be repository-relative, not absolute: "${entry}"`,
        400
      );
    }
    const normalized = normalizePath(trimmed);
    if (containsTraversalSegment(normalized)) {
      throw new ToolExecutionError(
        "INVALID_INPUT",
        `approvedPaths must not contain path traversal: "${entry}"`,
        400
      );
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  if (result.length === 0) {
    throw new ToolExecutionError(
      "INVALID_INPUT",
      "approvedPaths was supplied but contained no usable repository-relative path.",
      400
    );
  }

  return result;
}

/** Authoritative delete paths from patch-kit outputs (never upsert empty content). */
export function resolveValidatedDeliveryOps(
  patchKit: PatchKitPayload,
  validatedEdits: Array<{ path: string; content: string; baselineContentHash?: string }> = [],
  approvedPaths: string[] = []
): ValidatedDeliveryOps {
  const fromOps =
    patchKit.changeOperations?.filter((op) => op.type === "delete").map((op) => op.filePath) ?? [];
  const fromSummary = patchKit.summary.deletedPaths ?? [];
  const fromEmptyEdits = validatedEdits.filter((e) => e.content === "").map((e) => e.path);

  const candidateDeletes = uniquePaths([...fromSummary, ...fromOps, ...fromEmptyEdits]);
  const approved = new Set(uniquePaths(approvedPaths));

  // An explicitly approved path must ALSO have been confirmed by the
  // completed sandbox's own real `git apply --check`-equivalent validation
  // — not merely proposed by patch generation. Generation and validation
  // can disagree on a multi-file patch kit (e.g. a partially-validated
  // batch), and approval must never bridge that gap. Scoped to the approved
  // branch only: patch kits with no `validatedPaths` recorded (or callers
  // not using explicit approval at all) are unaffected, so every existing
  // operator-safe-default delete keeps working exactly as before.
  const sandboxValidated = patchKit.patchValidation?.validatedPaths;
  const sandboxValidatedSet = sandboxValidated ? new Set(uniquePaths(sandboxValidated)) : undefined;

  const deletePaths = uniquePaths([
    ...filterOperatorSafeDeletes(candidateDeletes),
    ...candidateDeletes.filter(
      (path) =>
        approved.has(path) &&
        isApprovedValidatedDeletePath(path) &&
        (!sandboxValidatedSet || sandboxValidatedSet.has(path))
    ),
  ]).sort();
  const allowed = new Set(deletePaths);
  const skippedDeletePaths = candidateDeletes.filter((p) => !allowed.has(p));

  const contentEdits = validatedEdits.filter((e) => e.content !== "");

  return { contentEdits, deletePaths, skippedDeletePaths };
}
