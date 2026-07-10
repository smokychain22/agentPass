import type { Finding } from "@/lib/findings/types";
import { isDoNotTouchPath, isRouteLikePath } from "@/lib/findings/confidence-path-rules";
import { isPhase1AutoFix, resolvePhase1Plugin } from "@/lib/execution/fix-plugins/phase1-plugins";

export type ActionabilityClass =
  | "automatic_fix"
  | "guided_repair"
  | "evidence_only"
  | "intentional"
  | "unsupported";

const EVIDENCE_ONLY_TYPES = new Set([
  "orphan_pattern",
  "orphan_route",
  "orphan_api",
]);

const SENSITIVE_PATH_RE =
  /(?:^|\/)(auth|login|oauth|payment|billing|checkout|stripe|middleware|migration|migrations|infra|infrastructure|security)(?:\/|$)/i;

function isSensitivePath(filePath: string): boolean {
  return SENSITIVE_PATH_RE.test(filePath.replace(/\\/g, "/"));
}

export function classifyFindingActionability(finding: Finding): ActionabilityClass {
  if (finding.action === "do_not_touch") return "intentional";
  if (finding.evidence.signals.some((s) => s.startsWith("intentional="))) {
    return "intentional";
  }

  if (finding.type === "duplicate_code") {
    if (finding.evidence.signals.some((s) => s.includes("cross_project"))) {
      return "guided_repair";
    }
    if (finding.confidence >= 0.85) return "guided_repair";
    return "evidence_only";
  }

  if (EVIDENCE_ONLY_TYPES.has(finding.type)) return "evidence_only";
  if (finding.files.some((f) => isDoNotTouchPath(f) || isRouteLikePath(f) || isSensitivePath(f))) {
    return "evidence_only";
  }

  if (isPhase1AutoFix(finding)) return "automatic_fix";

  const plugin = resolvePhase1Plugin(finding);
  if (plugin.id === "review_only") {
    if (finding.sourceMode === "fallback") return "evidence_only";
    return "unsupported";
  }

  return "unsupported";
}

export function actionabilityLabel(klass: ActionabilityClass): string {
  switch (klass) {
    case "automatic_fix":
      return "Automatic fix";
    case "guided_repair":
      return "Guided repair";
    case "evidence_only":
      return "Evidence-only review";
    case "intentional":
      return "Intentional — suppressed";
    case "unsupported":
      return "Unsupported transformation";
  }
}
