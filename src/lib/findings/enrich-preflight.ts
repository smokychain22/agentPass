import type { Finding } from "@/lib/findings/types";
import { isPhase1StructuralCandidate, resolvePhase1Plugin } from "@/lib/execution/fix-plugins/phase1-plugins";
import { runFixPreflight, type FixPreflightResult } from "@/lib/execution/fix-preflight";
import { countActionableFindings } from "@/lib/findings/actionability-signals";

export type { FixPreflightResult } from "@/lib/execution/fix-preflight";
export { countActionableFindings, isActionableFinding } from "@/lib/findings/actionability-signals";

export async function enrichFindingsWithPreflight(
  rootDir: string,
  findings: Finding[]
): Promise<{ findings: Finding[]; preflights: Map<string, FixPreflightResult> }> {
  const preflights = new Map<string, FixPreflightResult>();
  const updated = await Promise.all(
    findings.map(async (finding) => {
      if (!isPhase1StructuralCandidate(finding)) {
        return finding;
      }
      const preflight = await runFixPreflight(rootDir, finding);
      preflights.set(finding.id, preflight);
      const signals = finding.evidence.signals.filter(
        (s) => !s.startsWith("preflight=") && !s.startsWith("classification=")
      );
      signals.push(`preflight=${preflight.classification}`);
      signals.push(`classification=${preflight.classification}`);
      if (preflight.strategyId) signals.push(`strategyId=${preflight.strategyId}`);
      if (preflight.blocker) signals.push(`preflightBlocker=${preflight.blocker}`);
      return {
        ...finding,
        evidence: {
          ...finding.evidence,
          signals,
        },
      };
    })
  );
  return { findings: updated, preflights };
}
