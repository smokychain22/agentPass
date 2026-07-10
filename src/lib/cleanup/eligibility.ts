import type { Finding } from "@/lib/findings/types";
import { isDoNotTouchPath, isRouteLikePath } from "@/lib/findings/confidence-path-rules";

export const FREE_CLEANUP_LIMIT = 1;
export const QUICK_CLEANUP_LIMIT = 5;

const MIN_AUTO_FIX_CONFIDENCE = 0.75;

export function isProtectedFinding(finding: Finding): boolean {
  if (finding.action === "do_not_touch") return true;
  return finding.files.some((f) => isDoNotTouchPath(f) || isRouteLikePath(f));
}

export function isAutoFixEligible(finding: Finding): boolean {
  if (finding.action !== "safe_candidate") return false;
  if (isProtectedFinding(finding)) return false;
  if (finding.confidence < MIN_AUTO_FIX_CONFIDENCE) return false;
  if (finding.sourceMode === "fallback" && finding.type === "unused_file") return false;
  if (finding.type === "duplicate_code") return false;
  if (finding.type === "orphan_pattern") return false;
  return true;
}

export function isReviewPlanEligible(finding: Finding): boolean {
  if (isProtectedFinding(finding)) return false;
  if (finding.action === "do_not_touch") return false;
  return finding.confidence >= 0.45;
}

export function listAutoFixEligible(
  findings: Finding[],
  limit = FREE_CLEANUP_LIMIT
): Finding[] {
  return findings
    .filter(isAutoFixEligible)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

export function listReviewPlanEligible(
  findings: Finding[],
  limit = FREE_CLEANUP_LIMIT
): Finding[] {
  return findings
    .filter(isReviewPlanEligible)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

export function freeCleanupCta(findings: Finding[]): {
  mode: "auto_fix" | "review_plan";
  count: number;
  label: string;
} {
  const auto = listAutoFixEligible(findings);
  if (auto.length > 0) {
    return {
      mode: "auto_fix",
      count: 1,
      label: "Fix One Safe Issue Free",
    };
  }
  const review = listReviewPlanEligible(findings);
  const count = Math.min(review.length, FREE_CLEANUP_LIMIT);
  return {
    mode: "review_plan",
    count,
    label: count > 0 ? "Review Findings (No Safe Auto-Fix)" : "No Eligible Findings",
  };
}

export function eligibilityReason(finding: Finding): string {
  if (isProtectedFinding(finding)) return "Protected route, config, or framework file.";
  if (finding.action === "review_first") return "Requires manual review before any change.";
  if (finding.sourceMode === "fallback" && finding.type === "unused_file") {
    return "Fallback graph estimate — not eligible for automatic fix.";
  }
  if (finding.confidence < MIN_AUTO_FIX_CONFIDENCE) return "Confidence below automatic-fix threshold.";
  if (isAutoFixEligible(finding)) return "Eligible for conservative automatic fix.";
  return "Not eligible for automatic fix.";
}
