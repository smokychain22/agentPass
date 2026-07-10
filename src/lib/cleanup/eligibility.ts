import type { Finding } from "@/lib/findings/types";
import { isDoNotTouchPath, isRouteLikePath } from "@/lib/findings/confidence-path-rules";
import { isActionableFinding } from "@/lib/findings/actionability-signals";
import {
  isPhase1AutoFix,
  phase1EligibilityReason,
  resolvePhase1Plugin,
  PHASE1_MIN_CONFIDENCE,
} from "@/lib/execution/fix-plugins/phase1-plugins";

export const FREE_CLEANUP_LIMIT = 1;
export const QUICK_CLEANUP_LIMIT = 5;

export function isProtectedFinding(finding: Finding): boolean {
  if (finding.action === "do_not_touch") return true;
  return finding.files.some((f) => isDoNotTouchPath(f) || isRouteLikePath(f));
}

export function isAutoFixEligible(finding: Finding): boolean {
  return isPhase1AutoFix(finding) && isActionableFinding(finding);
}

export function isReviewPlanEligible(finding: Finding): boolean {
  if (isProtectedFinding(finding)) return false;
  if (finding.action === "do_not_touch") return false;
  if (isPhase1AutoFix(finding)) return false;
  return finding.confidence >= 0.45;
}

export function listAutoFixEligible(
  findings: Finding[],
  limit = FREE_CLEANUP_LIMIT
): Finding[] {
  return findings
    .filter(isPhase1AutoFix)
    .sort((a, b) => {
      const pa = resolvePhase1Plugin(a).id;
      const pb = resolvePhase1Plugin(b).id;
      const order = ["remove_temp_file", "remove_unused_import", "remove_unused_dependency"] as const;
      const ia = order.indexOf(pa as (typeof order)[number]);
      const ib = order.indexOf(pb as (typeof order)[number]);
      const sa = ia === -1 ? 99 : ia;
      const sb = ib === -1 ? 99 : ib;
      if (sa !== sb) return sa - sb;
      return b.confidence - a.confidence;
    })
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
      count: auto.length,
      label: "Fix One Safe Issue Free",
    };
  }
  const review = listReviewPlanEligible(findings);
  const count = Math.min(review.length, FREE_CLEANUP_LIMIT);
  return {
    mode: "review_plan",
    count,
    label:
      count > 0
        ? "Review Supported Findings"
        : "No Actionable Fixes — Review Findings",
  };
}

export function eligibilityReason(finding: Finding): string {
  return phase1EligibilityReason(finding);
}

export { resolvePhase1Plugin, PHASE1_MIN_CONFIDENCE };
