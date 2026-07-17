import type { Finding, FindingsPayload } from "./types";
import { isCleanupEligible } from "./cleanup-eligibility";

export type FindingSelectionErrorCode =
  | "FINDING_NOT_CLEANUP_ELIGIBLE"
  | "FINDING_UNKNOWN"
  | "FINDING_SCAN_MISMATCH"
  | "FINDING_REPOSITORY_MISMATCH"
  | "FINDING_PROTECTED"
  | "FINDING_REVIEW_FIRST";

export class FindingSelectionValidationError extends Error {
  readonly code: FindingSelectionErrorCode;

  constructor(
    code: FindingSelectionErrorCode,
    message: string,
    public readonly findingId?: string
  ) {
    super(message);
    this.code = code;
    this.name = "FindingSelectionValidationError";
  }
}

export function flattenFindingsPayload(payload: FindingsPayload): Finding[] {
  return [
    ...payload.duplicates,
    ...payload.unused.files,
    ...payload.unused.dependencies,
    ...payload.unused.exports,
    ...payload.orphans,
    ...payload.slopSignals,
  ];
}

/** Keep only currently cleanup-eligible finding IDs from a selection. */
export function sanitizeSelectedFindingIds(
  findings: Finding[],
  selectedFindingIds: string[]
): string[] {
  if (!selectedFindingIds.length) return [];
  const eligible = new Set(findings.filter(isCleanupEligible).map((f) => f.id));
  return selectedFindingIds.filter((id) => eligible.has(id));
}

export function sanitizeSelectedFindingIdsFromPayload(
  payload: FindingsPayload | null | undefined,
  selectedFindingIds: string[]
): string[] {
  if (!payload) return [];
  return sanitizeSelectedFindingIds(flattenFindingsPayload(payload), selectedFindingIds);
}

/**
 * Strict server-side validation for cleanup execution.
 * Rejects review-first, protected, unknown, stale, and cross-scan/repo IDs.
 */
export function assertValidCleanupSelection(input: {
  findings: FindingsPayload;
  selectedFindingIds: string[];
  expectedScanId?: string;
  expectedRepository?: { owner: string; name: string };
}): Finding[] {
  const { findings, selectedFindingIds } = input;
  if (!selectedFindingIds.length) {
    throw new FindingSelectionValidationError(
      "FINDING_UNKNOWN",
      "At least one cleanup-eligible finding must be selected."
    );
  }

  if (input.expectedScanId && findings.scanId !== input.expectedScanId) {
    throw new FindingSelectionValidationError(
      "FINDING_SCAN_MISMATCH",
      "Selected findings belong to a different scan."
    );
  }

  if (input.expectedRepository) {
    const owner = findings.repo.owner?.toLowerCase();
    const name = findings.repo.name?.toLowerCase();
    if (
      owner !== input.expectedRepository.owner.toLowerCase() ||
      name !== input.expectedRepository.name.toLowerCase()
    ) {
      throw new FindingSelectionValidationError(
        "FINDING_REPOSITORY_MISMATCH",
        "Selected findings belong to a different repository."
      );
    }
  }

  const byId = new Map(flattenFindingsPayload(findings).map((f) => [f.id, f]));
  const accepted: Finding[] = [];

  for (const id of selectedFindingIds) {
    const finding = byId.get(id);
    if (!finding) {
      throw new FindingSelectionValidationError(
        "FINDING_UNKNOWN",
        `Unknown or stale finding id: ${id}`,
        id
      );
    }
    if (finding.action === "do_not_touch" || finding.protected) {
      throw new FindingSelectionValidationError(
        "FINDING_PROTECTED",
        `Finding ${id} is protected and cannot be selected for cleanup.`,
        id
      );
    }
    if (finding.action === "review_first") {
      throw new FindingSelectionValidationError(
        "FINDING_REVIEW_FIRST",
        `Finding ${id} is review-first and cannot be selected for automatic cleanup.`,
        id
      );
    }
    if (!isCleanupEligible(finding)) {
      throw new FindingSelectionValidationError(
        "FINDING_NOT_CLEANUP_ELIGIBLE",
        `Finding ${id} is not cleanup-eligible.`,
        id
      );
    }
    accepted.push(finding);
  }

  return accepted;
}
