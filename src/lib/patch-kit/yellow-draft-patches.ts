import type { Finding } from "@/lib/findings/types";
import type { RemediationPlan } from "@/lib/patch-kit/remediation-class";
import { dryRunPhase1Fix } from "@/lib/execution/fix-preflight";
import { listStrategiesForFinding } from "@/lib/execution/fix-strategies";
import { resolvePhase1TransformPlugin } from "@/lib/execution/fix-plugins/phase1-plugins";

export interface YellowDraftPatch {
  findingId: string;
  title: string;
  filePath?: string;
  strategyId: string;
  unifiedDiff: string;
  reason: string;
}

export async function generateYellowDraftPatches(input: {
  rootDir: string;
  findings: Finding[];
  remediationPlan: RemediationPlan;
}): Promise<YellowDraftPatch[]> {
  const drafts: YellowDraftPatch[] = [];

  for (const item of input.remediationPlan.yellow) {
    const finding = input.findings.find((f) => f.id === item.findingId);
    if (!finding) continue;

    const plugin = resolvePhase1TransformPlugin(finding);
    const strategies = listStrategiesForFinding(finding, plugin.id).slice(0, 2);
    for (const strategy of strategies) {
      const change = await dryRunPhase1Fix(input.rootDir, finding, strategy.id);
      if (!change || change.unifiedDiff.length === 0) continue;
      drafts.push({
        findingId: finding.id,
        title: finding.title,
        filePath: finding.files[0],
        strategyId: strategy.id,
        unifiedDiff: change.unifiedDiff,
        reason: item.reason,
      });
      break;
    }
  }

  return drafts;
}
