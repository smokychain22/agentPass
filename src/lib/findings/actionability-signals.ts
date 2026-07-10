import type { Finding } from "@/lib/findings/types";
import { resolvePhase1Plugin } from "@/lib/execution/fix-plugins/phase1-plugins";

export function findingPreflightClassification(finding: Finding): string | undefined {
  const signal = finding.evidence.signals.find((s) => s.startsWith("classification="));
  return signal?.slice("classification=".length);
}

export function isActionableFinding(finding: Finding): boolean {
  if (findingPreflightClassification(finding) === "actionable_candidate") return true;
  const plugin = resolvePhase1Plugin(finding);
  return plugin.id !== "review_only" && finding.action === "safe_candidate" && finding.sourceMode === "native";
}

export function countActionableFindings(findings: Finding[]): number {
  return findings.filter(isActionableFinding).length;
}
