import type { Finding, FindingAction, SourceMode } from "@/lib/findings/types";
import { isActionableFinding } from "@/lib/findings/actionability-signals";
import { resolvePhase1Plugin } from "@/lib/execution/fix-plugins/phase1-plugins";
import { isDoNotTouchPath } from "@/lib/findings/confidence-path-rules";

export type FindingLifecycleState =
  | "detected"
  | "supported"
  | "generated"
  | "validated"
  | "verified"
  | "approved"
  | "delivered";

export type EvidenceGrade = "strong" | "moderate" | "weak";

export interface FindingLifecycleMeta {
  lifecycleState: FindingLifecycleState;
  evidenceGrade: EvidenceGrade;
  supportedTransformer: string | null;
  protected: boolean;
  protectionReason?: string;
  suggestedAction: string;
}

export function evidenceGradeForFinding(finding: Finding): EvidenceGrade {
  if (finding.evidenceBundle?.grade) {
    const g = finding.evidenceBundle.grade;
    if (g === "strong" || g === "moderate" || g === "weak") return g;
    return "weak";
  }
  if (finding.sourceMode === "native" && isActionableFinding(finding)) return "strong";
  if (finding.type === "unused_import" && finding.evidence.signals.some((s) => s.startsWith("symbol="))) {
    return finding.sourceMode === "heuristic" ? "moderate" : "strong";
  }
  if (finding.sourceMode === "fallback" || finding.source.endsWith("_fallback")) return "weak";
  if (finding.confidence >= 0.85) return "moderate";
  return "weak";
}

export function supportedTransformerFor(finding: Finding): string | null {
  if (finding.action === "do_not_touch") return null;
  const plugin = resolvePhase1Plugin(finding);
  if (plugin.id === "review_only") return null;
  if (!isActionableFinding(finding) && finding.action !== "safe_candidate") return null;
  return plugin.label;
}

export function isProtectedFinding(finding: Finding): boolean {
  if (finding.action === "do_not_touch") return true;
  return finding.files.some((f) => isDoNotTouchPath(f));
}

export function protectionReasonFor(finding: Finding): string | undefined {
  if (finding.action === "do_not_touch") return finding.reason;
  const protectedFile = finding.files.find((f) => isDoNotTouchPath(f));
  if (protectedFile) return `Protected path: ${protectedFile}`;
  return undefined;
}

export function lifecycleStateForFinding(
  finding: Finding,
  context?: { generatedFindingIds?: Set<string>; validatedFindingIds?: Set<string> }
): FindingLifecycleState {
  if (context?.validatedFindingIds?.has(finding.id)) return "validated";
  if (context?.generatedFindingIds?.has(finding.id)) return "generated";
  if (supportedTransformerFor(finding)) return "supported";
  return "detected";
}

export function enrichFindingLifecycle(
  finding: Finding,
  context?: { generatedFindingIds?: Set<string>; validatedFindingIds?: Set<string> }
): Finding & FindingLifecycleMeta {
  const protectedFinding = isProtectedFinding(finding);
  const transformer = supportedTransformerFor(finding);
  return {
    ...finding,
    lifecycleState: lifecycleStateForFinding(finding, context),
    evidenceGrade: evidenceGradeForFinding(finding),
    supportedTransformer: transformer,
    protected: protectedFinding,
    protectionReason: protectionReasonFor(finding),
    suggestedAction:
      finding.action === "do_not_touch"
        ? "Manual review only — protected"
        : transformer
          ? "Eligible for deterministic cleanup"
          : "Review first — no automatic transformer",
  };
}

export function countByLifecycle(findings: (Finding & Partial<FindingLifecycleMeta>)[]): {
  detected: number;
  supported: number;
  generated: number;
  validated: number;
} {
  let detected = 0;
  let supported = 0;
  let generated = 0;
  let validated = 0;
  for (const f of findings) {
    const state = f.lifecycleState ?? "detected";
    if (state === "validated") validated += 1;
    else if (state === "generated") generated += 1;
    else if (state === "supported") supported += 1;
    else detected += 1;
  }
  return { detected, supported, generated, validated };
}

export function analyzerDisplayName(source: string, sourceMode: SourceMode): string {
  if (sourceMode === "native") {
    if (source === "knip" || source === "knip_fallback") return "Knip";
    if (source === "jscpd" || source === "jscpd_fallback") return "jscpd";
    if (source === "madge" || source === "madge_fallback") return "Madge";
    return "Native analyzer";
  }
  if (sourceMode === "heuristic") return "RepoDiet heuristic";
  return "Internal fallback";
}
