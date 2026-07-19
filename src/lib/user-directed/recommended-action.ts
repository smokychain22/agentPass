import type { Finding } from "@/lib/findings/types";
import type { RequestedActionType } from "./types";

/**
 * Infer the recommended operation from finding evidence.
 * Users approve outcomes; RepoDiet picks the transformer.
 */
export function recommendedActionForFinding(finding: Finding): RequestedActionType {
  switch (finding.type) {
    case "unused_file":
    case "unused_export":
    case "orphan_pattern":
      return "DELETE";
    case "unused_import":
      return "EDIT";
    case "unused_dependency":
      return "REMOVE_DEPENDENCY";
    case "duplicate_code":
      return "CONSOLIDATE_DUPLICATES";
    case "ai_slop_signal":
      return finding.action === "safe_candidate" ? "DELETE" : "INSPECT";
    default:
      if (finding.action === "safe_candidate") return "DELETE";
      if (finding.action === "do_not_touch") return "KEEP";
      return "INSPECT";
  }
}

export function outcomeLabelForFinding(finding: Finding): string {
  switch (finding.type) {
    case "unused_file":
      return "Remove unused module";
    case "unused_import":
      return "Remove unused import";
    case "unused_export":
      return "Remove unused export";
    case "unused_dependency":
      return "Remove unused dependency";
    case "duplicate_code":
      return "Consolidate duplicate group";
    case "orphan_pattern":
      return "Review orphan module";
    default:
      return finding.title;
  }
}

export function resultLabelForAction(
  action: RequestedActionType,
  pathCount: number
): string {
  switch (action) {
    case "DELETE":
      return pathCount <= 1 ? "delete one file" : `delete ${pathCount} files`;
    case "CONSOLIDATE_DUPLICATES":
      return "keep one canonical file and update references";
    case "UPDATE_REFERENCES":
      return "update references";
    case "EDIT":
      return "edit file contents";
    case "REMOVE_DEPENDENCY":
      return "remove dependency from package manifest";
    case "KEEP":
    case "SUPPRESS":
      return "no file changes";
    default:
      return "apply bounded transformation";
  }
}
