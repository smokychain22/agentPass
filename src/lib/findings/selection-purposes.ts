/**
 * Selection purposes — cleanup, review, and inspection are strictly separate.
 * REVIEW FIRST / DO NOT TOUCH IDs must never enter cleanup selection.
 */
import type { Finding, FindingsPayload } from "./types";
import { isCleanupEligible } from "./cleanup-eligibility";
import { flattenFindingsPayload } from "./selection";

export type FindingSelectionPurpose = "cleanup" | "review" | "inspection";

export interface FindingCheckboxState {
  purpose: FindingSelectionPurpose | null;
  enabled: boolean;
  ariaLabel: string;
  dataPurpose: FindingSelectionPurpose | "none";
}

/** Resolve which selection bucket a finding belongs to (if any). */
export function selectionPurposeOf(finding: Finding): FindingSelectionPurpose | null {
  if (finding.action === "do_not_touch" || finding.protected) {
    return "inspection";
  }
  if (finding.action === "review_first") {
    return "review";
  }
  if (finding.action === "safe_candidate" && isCleanupEligible(finding)) {
    return "cleanup";
  }
  // SAFE but not cleanup-eligible: not selectable for cleanup or review here.
  return null;
}

export function getFindingCheckboxState(finding: Finding): FindingCheckboxState {
  const purpose = selectionPurposeOf(finding);
  if (purpose === "cleanup") {
    return {
      purpose,
      enabled: true,
      ariaLabel: `Select ${finding.title} for cleanup`,
      dataPurpose: "cleanup",
    };
  }
  if (purpose === "review") {
    return {
      purpose,
      enabled: true,
      ariaLabel: "Select for deeper review",
      dataPurpose: "review",
    };
  }
  if (purpose === "inspection") {
    return {
      purpose,
      enabled: true,
      ariaLabel: `Select ${finding.title} for inspection`,
      dataPurpose: "inspection",
    };
  }
  return {
    purpose: null,
    enabled: false,
    ariaLabel: `${finding.title} — Not eligible for automatic cleanup`,
    dataPurpose: "none",
  };
}

export function sanitizeReviewSelectedFindingIds(
  findings: Finding[],
  selectedIds: string[]
): string[] {
  if (!selectedIds.length) return [];
  const allowed = new Set(
    findings.filter((f) => selectionPurposeOf(f) === "review").map((f) => f.id)
  );
  return selectedIds.filter((id) => allowed.has(id));
}

export function sanitizeInspectionSelectedFindingIds(
  findings: Finding[],
  selectedIds: string[]
): string[] {
  if (!selectedIds.length) return [];
  const allowed = new Set(
    findings.filter((f) => selectionPurposeOf(f) === "inspection").map((f) => f.id)
  );
  return selectedIds.filter((id) => allowed.has(id));
}

export function sanitizeReviewSelectedFindingIdsFromPayload(
  payload: FindingsPayload | null | undefined,
  selectedIds: string[]
): string[] {
  if (!payload) return [];
  return sanitizeReviewSelectedFindingIds(flattenFindingsPayload(payload), selectedIds);
}

export function sanitizeInspectionSelectedFindingIdsFromPayload(
  payload: FindingsPayload | null | undefined,
  selectedIds: string[]
): string[] {
  if (!payload) return [];
  return sanitizeInspectionSelectedFindingIds(flattenFindingsPayload(payload), selectedIds);
}

/** Off-filter cleanup selection copy when the active bucket hides selected cleanup IDs. */
export function offFilterCleanupSelectionMessage(input: {
  activeBucket: "all" | "safe_candidate" | "review_first" | "do_not_touch";
  cleanupSelectedIds: string[];
  findings: Finding[];
  visibleFindingIds: Set<string>;
}): string | null {
  const { cleanupSelectedIds, findings, visibleFindingIds, activeBucket } = input;
  if (!cleanupSelectedIds.length) return null;
  const outside = cleanupSelectedIds.filter((id) => !visibleFindingIds.has(id));
  if (!outside.length) return null;
  if (activeBucket !== "review_first") {
    const n = outside.length;
    return `${n} cleanup finding${n === 1 ? "" : "s"} selected outside the current filter`;
  }
  const n = outside.length;
  return `${n} cleanup finding${n === 1 ? "" : "s"} selected outside the current Review First filter`;
}

/** Review actions are client-side only — never touch the repository. */
export type ReviewQueueAction = "deeper_verification" | "review_queue" | "clear";

export interface ReviewActionResult {
  action: ReviewQueueAction;
  reviewSelectedFindingIds: string[];
  repositoryWritePerformed: false;
  message: string;
}

export function runReviewSelectionAction(
  action: ReviewQueueAction,
  reviewSelectedFindingIds: string[]
): ReviewActionResult {
  if (action === "clear") {
    return {
      action,
      reviewSelectedFindingIds: [],
      repositoryWritePerformed: false,
      message: "Review selection cleared.",
    };
  }
  if (action === "deeper_verification") {
    return {
      action,
      reviewSelectedFindingIds: [...reviewSelectedFindingIds],
      repositoryWritePerformed: false,
      message:
        reviewSelectedFindingIds.length === 0
          ? "Select REVIEW FIRST findings to run deeper verification."
          : `Queued ${reviewSelectedFindingIds.length} finding${
              reviewSelectedFindingIds.length === 1 ? "" : "s"
            } for deeper verification (no repository changes).`,
    };
  }
  return {
    action: "review_queue",
    reviewSelectedFindingIds: [...reviewSelectedFindingIds],
    repositoryWritePerformed: false,
    message:
      reviewSelectedFindingIds.length === 0
        ? "Select REVIEW FIRST findings to add to the review queue."
        : `Added ${reviewSelectedFindingIds.length} finding${
            reviewSelectedFindingIds.length === 1 ? "" : "s"
          } to the review queue (no repository changes).`,
  };
}

/** Invariant: review/inspection IDs never enable Quick Cleanup. */
export function reviewSelectionCanTriggerCleanup(
  reviewSelectedFindingIds: string[],
  cleanupSelectedFindingIds: string[]
): boolean {
  void reviewSelectedFindingIds;
  return cleanupSelectedFindingIds.length > 0;
}
