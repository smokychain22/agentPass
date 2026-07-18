import type { Finding } from "@/lib/findings/types";
import { isCleanupEligible } from "@/lib/findings/cleanup-eligibility";

/** Short file name for non-technical display. */
export function findingFileName(finding: Finding): string {
  const path = finding.files[0] ?? findingTargetPath(finding);
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path || "Unknown file";
}

export function findingTargetPath(finding: Finding): string {
  if (finding.files[0]) return finding.files[0];
  if (finding.type === "unused_dependency") {
    return finding.title.replace(/^Unused dependency:\s*/i, "") || finding.title;
  }
  return finding.title;
}

/** Primary action headline shown to non-coders. */
export function plainLanguageTitle(finding: Finding): string {
  switch (finding.type) {
    case "unused_file":
      if (finding.evidence.signals?.includes("empty_file=true")) {
        return "Remove empty unused file";
      }
      return "Remove confirmed unused file";
    case "unused_import":
      return "Remove unused import";
    case "unused_export":
      return "Remove unused export";
    case "unused_dependency":
      return "Remove unused package dependency";
    case "duplicate_code":
      if (finding.evidence.signals?.includes("exact_file_duplicate=true")) {
        return "Consolidate duplicate file";
      }
      return "Review similar code";
    case "orphan_pattern":
      return "Review possibly unused module";
    case "ai_slop_signal":
      return "Review AI-generated leftover code";
    default:
      return finding.title;
  }
}

/** Why RepoDiet believes this is unused / safe — plain language. */
export function plainLanguageWhy(finding: Finding): string {
  const signals = finding.evidence.signals ?? [];
  const inboundZero =
    signals.some((s) => s === "inbound_refs=0" || s === "inboundImports=0") ||
    signals.includes("empty_file=true");

  if (finding.type === "unused_file" && inboundZero) {
    return "This file is not imported or referenced anywhere in the repository.";
  }
  if (finding.type === "unused_import") {
    return "This import is never used in the file that declares it.";
  }
  if (finding.type === "unused_dependency") {
    return "This package is listed in package.json but does not appear to be used by the project.";
  }
  if (finding.type === "duplicate_code" && signals.includes("exact_file_duplicate=true")) {
    return "Another file contains the exact same contents. RepoDiet can keep one copy and update imports.";
  }
  if (finding.type === "duplicate_code") {
    return "Similar code appears in more than one place. A human should confirm before automatic changes.";
  }
  if (finding.action === "do_not_touch") {
    return "This path looks important to the app (route, config, or protected pattern). RepoDiet will not change it automatically.";
  }
  if (finding.action === "review_first") {
    return "There is a signal this may be unused, but RepoDiet is not confident enough for automatic cleanup yet.";
  }
  return finding.evidence.summary || finding.reason || "RepoDiet detected a possible cleanup opportunity.";
}

/** What will change if the user selects this for Fix & PR. */
export function plainLanguageWhatChanges(finding: Finding): string {
  if (!isCleanupEligible(finding)) {
    if (finding.action === "review_first") {
      return "Nothing will change automatically until a supported cleanup path is available. You can keep it selected for review.";
    }
    return "Nothing will change automatically — this item is protected or not eligible for Fix & PR.";
  }
  if (finding.type === "unused_file") {
    return "RepoDiet will remove only this file, then verify the project before opening a pull request.";
  }
  if (finding.type === "unused_import") {
    return "RepoDiet will delete the unused import line in this file and verify the project.";
  }
  if (finding.type === "duplicate_code") {
    return "RepoDiet will keep one canonical file, update imports, and delete the duplicate.";
  }
  if (finding.type === "unused_dependency") {
    return "RepoDiet will remove the unused dependency from package.json when that transformer is available.";
  }
  return "RepoDiet will apply a bounded cleanup for this item and verify before opening a pull request.";
}

export type PlainRiskLevel = "safe" | "review" | "protected";

export function plainRiskLevel(finding: Finding): PlainRiskLevel {
  if (finding.action === "do_not_touch") return "protected";
  if (isCleanupEligible(finding)) return "safe";
  return "review";
}

export function plainRiskLabel(finding: Finding): string {
  const level = plainRiskLevel(finding);
  if (level === "safe") return "Safe cleanup";
  if (level === "protected") return "Do not change";
  return "Needs review";
}

/** Why automation is blocked — shown when selection cannot go to Fix & PR. */
export function automationBlockReason(finding: Finding): string | null {
  if (isCleanupEligible(finding)) return null;
  if (finding.action === "do_not_touch") {
    return "Protected path — automatic cleanup is disabled for routes, config, and similar files.";
  }
  if (finding.action === "review_first") {
    return "Needs review — no supported automatic transformer passed preflight for this finding yet.";
  }
  return "Not eligible for automatic Fix & PR with the current evidence.";
}
