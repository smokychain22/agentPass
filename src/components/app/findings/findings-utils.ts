import type { Finding, FindingAction, FindingType } from "@/lib/findings/types";

export function typeLabel(type: FindingType): string {
  const map: Record<FindingType, string> = {
    duplicate_code: "Duplicate",
    unused_file: "Unused File",
    unused_dependency: "Dependency",
    unused_export: "Unused Export",
    unused_import: "Unused Import",
    orphan_pattern: "Orphan",
    ai_slop_signal: "AI Slop",
  };
  return map[type] ?? type;
}

export function actionLabel(action: FindingAction): string {
  const map: Record<FindingAction, string> = {
    safe_candidate: "Safe Candidate",
    review_first: "Review First",
    do_not_touch: "Do Not Touch",
  };
  return map[action];
}

export function actionVariant(
  action: FindingAction
): "signal" | "electric" | "default" {
  if (action === "safe_candidate") return "signal";
  if (action === "do_not_touch") return "default";
  return "electric";
}

export function severityColor(severity: string): string {
  if (severity === "high") return "text-red-400";
  if (severity === "low") return "text-signal";
  return "text-amber-300";
}

export function confidenceExplanation(confidence: number): string {
  const pct = Math.round(confidence * 100);
  if (pct >= 80) return `High confidence (${pct}%) — strong signals from analysis tools.`;
  if (pct >= 65) return `Moderate confidence (${pct}%) — review recommended before action.`;
  return `Lower confidence (${pct}%) — verify manually before any cleanup.`;
}

export function patchPreview(finding: Finding): string {
  if (finding.action === "do_not_touch") {
    return "No patch action — protected by RepoDiet policy.";
  }
  if (finding.type === "duplicate_code") {
    return "Included in review-first recommendations; merge/refactor before deletion.";
  }
  if (finding.type === "unused_dependency") {
    return "Package removal suggestion in package-cleanup.md after verification.";
  }
  if (finding.type === "unused_file" && finding.action === "safe_candidate") {
    return "Candidate for developer review in cleanup patch bundle.";
  }
  return "Included in conservative cleanup recommendations after confirmation.";
}

export function sourceLabel(source: Finding["source"]): string {
  const map: Record<Finding["source"], string> = {
    knip: "knip",
    jscpd: "jscpd",
    madge: "madge",
    heuristic: "heuristic",
    knip_fallback: "knip (fallback)",
    jscpd_fallback: "jscpd (fallback)",
    madge_fallback: "madge (fallback)",
  };
  return map[source] ?? source;
}

export function findingTarget(finding: Finding): string {
  if (finding.packageName) return finding.packageName;
  if (finding.files.length === 1) return finding.files[0];
  return `${finding.files.length} files`;
}
