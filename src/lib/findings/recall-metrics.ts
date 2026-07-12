import type { Finding } from "@/lib/findings/types";
import type { DetectorRerunResult } from "@/lib/verification/post-patch-verification";

export interface RuleFamilyRecall {
  ruleFamily: string;
  appliedCount: number;
  resolvedCount: number;
  recall: number;
}

const TYPE_TO_FAMILY: Record<Finding["type"], string> = {
  unused_import: "unused_import",
  unused_file: "unused_file",
  unused_dependency: "unused_dependency",
  unused_export: "unused_export",
  duplicate_code: "duplicate_code",
  orphan_pattern: "orphan_pattern",
  ai_slop_signal: "ai_slop_signal",
};

export function computeRecallByRuleFamily(
  appliedFindings: Finding[],
  reruns: DetectorRerunResult[]
): RuleFamilyRecall[] {
  const rerunById = new Map(reruns.map((r) => [r.findingId, r]));
  const byFamily = new Map<string, { applied: number; resolved: number }>();

  for (const finding of appliedFindings) {
    const family = TYPE_TO_FAMILY[finding.type] ?? finding.type;
    const entry = byFamily.get(family) ?? { applied: 0, resolved: 0 };
    entry.applied += 1;
    if (rerunById.get(finding.id)?.passed) entry.resolved += 1;
    byFamily.set(family, entry);
  }

  return [...byFamily.entries()].map(([ruleFamily, stats]) => ({
    ruleFamily,
    appliedCount: stats.applied,
    resolvedCount: stats.resolved,
    recall: stats.applied === 0 ? 1 : stats.resolved / stats.applied,
  }));
}
