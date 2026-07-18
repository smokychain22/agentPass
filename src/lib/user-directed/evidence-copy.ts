import type { Finding } from "@/lib/findings/types";
import { isCleanupEligible } from "@/lib/findings/cleanup-eligibility";
import { pathIndicators } from "./path-identity";

/**
 * Evidence-based finding copy — facts over generic confidence words.
 */
export function evidenceBasedFindingExplanation(finding: Finding): string {
  const path = finding.files[0] ?? finding.title;
  const indicators = pathIndicators(path);
  const signals = finding.evidence.signals ?? [];
  const inboundZero = signals.some((s) => /inbound(_refs|Refs|Imports)?=0/i.test(s));
  const actionable = signals.includes("classification=actionable_candidate");
  const emptyFile = signals.includes("empty_file=true");
  const exactDup = signals.includes("exact_file_duplicate=true");

  if (indicators.generated) {
    return `This generated file should be changed through its source generator. Unreferenced appearance alone is not enough for automatic deletion.`;
  }
  if (indicators.protected && finding.action !== "safe_candidate") {
    return `${finding.source} found limited static imports for “${path}”, but this path matches a runtime/config or framework convention. Automatic deletion is blocked until route/runtime discovery confirms it is inactive.`;
  }
  if (finding.type === "duplicate_code" && exactDup) {
    return `${finding.source} reports an exact content duplicate involving “${path}”. RepoDiet can keep one canonical file, update imports, and delete the duplicate after you choose the canonical.`;
  }
  if (finding.type === "duplicate_code") {
    return `${finding.source} found structural similarity involving “${path}”. Choose a canonical file or keep all copies — consolidation requires an explicit plan and validation.`;
  }
  if (actionable && inboundZero && isCleanupEligible(finding)) {
    if (emptyFile) {
      return `${finding.source} found no imports, the file is empty, inbound references are 0, and preflight classification is actionable_candidate. RepoDiet found sufficient evidence for a bounded deletion plan.`;
    }
    return `${finding.source} found no static imports for “${path}”, inbound references are 0, and preflight classification is actionable_candidate. RepoDiet found sufficient evidence for this transformation.`;
  }
  if (finding.action === "review_first") {
    return `${finding.source} raised a signal for “${path}”, but evidence is incomplete or contradicted. Additional verification is required before RepoDiet can safely apply this request.`;
  }
  if (finding.action === "do_not_touch") {
    return `“${path}” is protected by policy (route, config, generated, or similar). You may still inspect or request a custom plan; automatic execution stays blocked.`;
  }
  return (
    finding.evidence.summary ||
    `${finding.source} reported “${path}” with confidence ${finding.confidence}. Review the evidence details before requesting a change.`
  );
}

export function evidenceBasedNextStep(finding: Finding): string {
  if (isCleanupEligible(finding)) {
    return "Select this path, review the exact patch preview, then continue to a dynamic quote.";
  }
  if (finding.action === "review_first") {
    return "Run deeper verification, request a deletion/edit plan, or mark as intentionally retained.";
  }
  if (finding.action === "do_not_touch") {
    return "Inspect the path, suppress the suggestion, or request a generator/config-aware plan.";
  }
  return "Select the path in Repository Explorer and choose the action you want RepoDiet to analyze.";
}
