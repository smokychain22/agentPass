import type { Finding, FindingAction } from "@/lib/findings/types";
import { isDoNotTouchPath } from "@/lib/findings/confidence-path-rules";
import type { EvidenceItem } from "./types";
import type {
  ClassificationLabel,
  ClassificationState,
  FusionEvidenceGrade,
  ReferenceChannelStatus,
} from "./types";

export interface DecisionInput {
  finding: Finding;
  counterEvidence: EvidenceItem[];
  channels: ReferenceChannelStatus;
  hasPreflightActionable: boolean;
  transformerAvailable: boolean;
  actionable: boolean;
}

export interface DecisionOutput {
  action: FindingAction;
  grade: FusionEvidenceGrade;
  classificationState: ClassificationState;
  classificationLabel: ClassificationLabel;
  decisionReason: string;
  autoFixAllowed: boolean;
}

const DESTRUCTIVE_TYPES = new Set([
  "unused_file",
  "orphan_pattern",
  "duplicate_code",
  "unused_dependency",
]);

function hasContradiction(counter: EvidenceItem[]): boolean {
  return counter.some((i) => i.strength === "contradicting");
}

function nativeAnalyzer(finding: Finding): boolean {
  return finding.sourceMode === "native" && !finding.source.endsWith("_fallback");
}

function gradeForFinding(input: DecisionInput): FusionEvidenceGrade {
  const { finding, counterEvidence, channels, hasPreflightActionable, actionable } = input;

  if (hasContradiction(counterEvidence)) return "contradictory";
  if (channels.incomplete.length > 0 && DESTRUCTIVE_TYPES.has(finding.type)) {
    return "insufficient";
  }
  if (!nativeAnalyzer(finding) && DESTRUCTIVE_TYPES.has(finding.type)) {
    return "insufficient";
  }
  if (finding.type === "unused_import" && finding.evidence.signals.some((s) => s.startsWith("symbol="))) {
    return hasPreflightActionable && actionable ? "strong" : "moderate";
  }
  if (finding.type === "duplicate_code") {
    const exact = finding.evidence.signals.some((s) => s.startsWith("exact_duplicate=true"));
    return exact && nativeAnalyzer(finding) ? "moderate" : "weak";
  }
  if (finding.type === "unused_file") {
    const inbound = finding.evidence.signals.find((s) => s.startsWith("inbound_refs="));
    const inboundZero = inbound?.endsWith("=0");
    if (nativeAnalyzer(finding) && inboundZero && hasPreflightActionable) return "strong";
    if (nativeAnalyzer(finding) && inboundZero) return "moderate";
    return "weak";
  }
  if (finding.type === "orphan_pattern") {
    return nativeAnalyzer(finding) ? "moderate" : "insufficient";
  }
  if (finding.type === "unused_dependency") {
    return nativeAnalyzer(finding) ? "moderate" : "insufficient";
  }
  if (actionable && hasPreflightActionable) return "moderate";
  return "weak";
}

function labelFor(input: DecisionInput, grade: FusionEvidenceGrade): ClassificationLabel {
  const { finding, counterEvidence } = input;
  if (finding.files.some((f) => isDoNotTouchPath(f)) || finding.protected) {
    return "protected";
  }
  if (hasContradiction(counterEvidence) || grade === "contradictory") {
    return "review_required";
  }
  if (grade === "insufficient") return "review_required";

  switch (finding.type) {
    case "unused_file": {
      const backup = finding.evidence.signals.some((s) => s.includes("backup") || s.includes("archive"));
      if (backup) return "backup_archive_candidate";
      if (grade === "strong" && input.hasPreflightActionable) return "eligible_for_removal";
      if (grade === "strong") return "confirmed_unused";
      return "potentially_unreferenced";
    }
    case "orphan_pattern":
      return "potential_orphan";
    case "duplicate_code":
      return finding.evidence.signals.some((s) => s.startsWith("exact_duplicate=true"))
        ? "exact_duplicate"
        : "near_duplicate";
    case "unused_import":
      return grade === "strong" ? "unused_import_confirmed" : "review_required";
    case "unused_dependency":
      return "unused_dependency_suspected";
    case "ai_slop_signal":
      return "stale_looking";
    default:
      return "review_required";
  }
}

function stateFor(grade: FusionEvidenceGrade, label: ClassificationLabel): ClassificationState {
  if (label === "protected") return "protected";
  if (grade === "insufficient" || grade === "contradictory") return "insufficient_evidence";
  if (grade === "weak") return "signal";
  if (label === "review_required" || label === "potentially_unreferenced" || label === "potential_orphan") {
    return "candidate";
  }
  if (grade === "moderate") return "corroborated";
  return "supported";
}

function actionFor(input: DecisionInput, grade: FusionEvidenceGrade, label: ClassificationLabel): FindingAction {
  const { finding, transformerAvailable, hasPreflightActionable, actionable } = input;

  if (label === "protected" || finding.files.some((f) => isDoNotTouchPath(f))) {
    return "do_not_touch";
  }
  if (grade === "contradictory" || grade === "insufficient") {
    return "review_first";
  }

  const destructive = DESTRUCTIVE_TYPES.has(finding.type);

  if (destructive) {
    if (grade !== "strong") return "review_first";
    if (!nativeAnalyzer(finding)) return "review_first";
    if (!transformerAvailable) return "review_first";
    if (!hasPreflightActionable && finding.type !== "unused_file") return "review_first";
    if (finding.type === "orphan_pattern") return "review_first";
    if (finding.type === "duplicate_code" && label !== "exact_duplicate") return "review_first";
    if (finding.type === "unused_dependency") return "review_first";
    return "safe_candidate";
  }

  if (finding.type === "unused_import") {
    if (grade === "strong" && actionable && transformerAvailable && hasPreflightActionable) {
      return "safe_candidate";
    }
    return "review_first";
  }

  return finding.action === "do_not_touch" ? "do_not_touch" : "review_first";
}

export function decideClassification(input: DecisionInput): DecisionOutput {
  const grade = gradeForFinding(input);
  const classificationLabel = labelFor(input, grade);
  const classificationState = stateFor(grade, classificationLabel);
  const action = actionFor(input, grade, classificationLabel);

  const autoFixAllowed =
    action === "safe_candidate" &&
    grade === "strong" &&
    input.transformerAvailable &&
    (input.hasPreflightActionable || input.finding.type === "unused_import") &&
    !hasContradiction(input.counterEvidence);

  let decisionReason: string;
  if (classificationLabel === "protected") {
    decisionReason = "Protected path or framework entry point — automatic deletion forbidden.";
  } else if (grade === "contradictory") {
    decisionReason =
      "Counter-evidence found (route, export, script, config, or dynamic reference). Review required.";
  } else if (grade === "insufficient") {
    decisionReason =
      "Insufficient cross-tool evidence for automatic cleanup. Native analyzer agreement and reference channels required.";
  } else if (autoFixAllowed) {
    decisionReason = "Strong corroborated evidence with transformer preflight — eligible for deterministic repair.";
  } else if (classificationState === "corroborated") {
    decisionReason = "Moderate evidence — review before applying automatic changes.";
  } else {
    decisionReason = "Signal only — not promoted to automatic cleanup.";
  }

  return {
    action,
    grade,
    classificationState,
    classificationLabel,
    decisionReason,
    autoFixAllowed,
  };
}
