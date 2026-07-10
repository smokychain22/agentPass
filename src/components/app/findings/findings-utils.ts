import type { Finding, FindingAction, FindingType, FindingsPayload } from "@/lib/findings/types";
import { isActionableFinding } from "@/lib/findings/actionability-signals";
import { findingAnalyzerLabel } from "@/lib/findings/analyzer-status";
import type { EvidenceGrade } from "@/lib/workflow/lifecycle";
import { evidenceGradeForFinding } from "@/lib/workflow/lifecycle";

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

export function evidenceStrengthLabel(grade: EvidenceGrade): string {
  const label = grade.charAt(0).toUpperCase() + grade.slice(1);
  return `Evidence strength: ${label}`;
}

export function evidenceStrengthForFinding(finding: Finding): EvidenceGrade {
  return finding.evidenceGrade ?? evidenceGradeForFinding(finding);
}

export function measurableEvidenceLines(finding: Finding): string[] {
  const lines: string[] = [];
  const grade = evidenceStrengthForFinding(finding);
  lines.push(evidenceStrengthLabel(grade));

  const { name, mode } = findingAnalyzerLabel(finding);
  lines.push(
    `Analyzer: ${name} · ${mode === "native" ? "Native" : mode === "fallback" ? "Fallback" : "Failed"}`
  );

  if (finding.type === "duplicate_code") {
    const dupLines = finding.evidence.signals.find((s) => s.startsWith("lines="));
    const similarity = finding.evidence.signals.find((s) => s.startsWith("similarity="));
    if (dupLines) lines.push(`Duplicated lines: ${dupLines.slice("lines=".length)}`);
    if (similarity) lines.push(`Similarity: ${similarity.slice("similarity=".length)}`);
    if (finding.files.length >= 2) {
      lines.push(`File pair: ${finding.files[0]} ↔ ${finding.files[1]}`);
    }
    const ranges = finding.evidence.signals.filter((s) => s.startsWith("range="));
    for (const range of ranges.slice(0, 4)) {
      lines.push(`Matching range: ${range.slice("range=".length)}`);
    }
  }

  if (finding.evidence.summary) {
    lines.push(finding.evidence.summary);
  }

  return lines;
}

/** @deprecated Use evidenceStrengthForFinding + measurableEvidenceLines */
export function confidenceExplanation(confidence: number): string {
  if (confidence >= 0.85) return "Evidence strength: Strong";
  if (confidence >= 0.65) return "Evidence strength: Moderate";
  return "Evidence strength: Weak";
}

export function patchPreview(finding: Finding): string {
  if (finding.action === "do_not_touch") {
    return "Protected — RepoDiet will not modify this path.";
  }
  if (isActionableFinding(finding)) {
    switch (finding.type) {
      case "unused_import":
        return "Auto-fix: remove unused import from source file in cleanup PR.";
      case "unused_dependency":
        return "Auto-fix: remove package from package.json and update lockfile in cleanup PR.";
      case "unused_file":
      case "ai_slop_signal":
        return "Auto-fix: delete temp/archive/backup file when path matches safe patterns.";
      default:
        return "Eligible for automatic cleanup in Quick Cleanup.";
    }
  }
  if (finding.type === "duplicate_code") {
    return "Review first — deduplicate or extract shared code manually; auto-merge not supported yet.";
  }
  if (finding.type === "orphan_pattern") {
    return "Review first — confirm route/API is unused before removal.";
  }
  if (finding.type === "unused_dependency") {
    return "Review package removal — dynamic imports or config references may exist.";
  }
  if (finding.type === "unused_file" && finding.action === "safe_candidate") {
    return "Review file deletion — path does not match automatic temp-file patterns.";
  }
  return "Documented for review in cleanup artifacts.";
}

export function formatFindingAnalyzerLabel(
  finding: Finding,
  reports?: FindingsPayload["rawToolReports"]
): string {
  const { name, mode } = findingAnalyzerLabel(finding, reports);
  const modeLabel =
    mode === "native" ? "Native" : mode === "fallback" ? "Fallback" : "Failed";
  return `${name} · ${modeLabel}`;
}

/** @deprecated Use formatFindingAnalyzerLabel with rawToolReports */
export function sourceLabel(source: Finding["source"]): string {
  const map: Record<Finding["source"], string> = {
    knip: "Knip · Native",
    jscpd: "jscpd · Native",
    madge: "Madge · Native",
    heuristic: "RepoDiet heuristic · Native",
    repodiet_import: "RepoDiet import analyzer · Native",
    knip_fallback: "Internal import graph · Fallback",
    jscpd_fallback: "Internal duplicate detector · Fallback",
    madge_fallback: "Internal dependency graph · Fallback",
  };
  return map[source] ?? source;
}

export function findingTarget(finding: Finding): string {
  if (finding.packageName) return finding.packageName;
  if (finding.files.length === 1) return finding.files[0];
  return `${finding.files.length} files`;
}
