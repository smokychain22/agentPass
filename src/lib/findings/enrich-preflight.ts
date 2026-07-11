import type { Finding } from "@/lib/findings/types";
import { isPhase1StructuralCandidate, resolvePhase1Plugin } from "@/lib/execution/fix-plugins/phase1-plugins";
import { runFixPreflight, type FixPreflightResult } from "@/lib/execution/fix-preflight";
import { blockerCodeFromPreflight } from "@/lib/execution/candidate-lifecycle";
import {
  countActionableFindings,
  countDryRunPassed,
  countTransformerCompatible,
} from "@/lib/findings/actionability-signals";

export type { FixPreflightResult } from "@/lib/execution/fix-preflight";
export { countActionableFindings, countDryRunPassed, countTransformerCompatible, isActionableFinding } from "@/lib/findings/actionability-signals";

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
      const blockerCode = blockerCodeFromPreflight(preflight);
      const signals = finding.evidence.signals.filter(
        (s) =>
          !s.startsWith("preflight=") &&
          !s.startsWith("classification=") &&
          !s.startsWith("preflightBlocker=") &&
          !s.startsWith("blockerCode=")
      );
      signals.push(`preflight=${preflight.classification}`);
      signals.push(`classification=${preflight.classification}`);
      if (preflight.strategyId) signals.push(`strategyId=${preflight.strategyId}`);
      if (preflight.blocker) signals.push(`preflightBlocker=${preflight.blocker}`);
      if (blockerCode) signals.push(`blockerCode=${blockerCode}`);
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
