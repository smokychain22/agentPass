import type { Finding } from "@/lib/findings/types";
import {
  isPhase1AutoFix,
  isPhase1StructuralCandidate,
  resolvePhase1Plugin,
} from "@/lib/execution/fix-plugins/phase1-plugins";

export function findingPreflightClassification(finding: Finding): string | undefined {
  const signal = finding.evidence.signals.find((s) => s.startsWith("classification="));
  return signal?.slice("classification=".length);
}

/** Plugin claims it understands this finding type (not yet proven). */
export function isTransformerCompatible(finding: Finding): boolean {
  return isPhase1AutoFix(finding);
}

/** Dry-run produced a real source change at the scanned commit. */
export function isDryRunPassed(finding: Finding): boolean {
  return findingPreflightClassification(finding) === "actionable_candidate";
}

/**
 * Eligible for Quick Cleanup execution — requires dry-run proof, not just plugin registration.
 */
export function isActionableFinding(finding: Finding): boolean {
  if (!isDryRunPassed(finding)) return false;
  const plugin = resolvePhase1Plugin(finding);
  return plugin.id !== "review_only" && isPhase1StructuralCandidate(finding);
}

export function countActionableFindings(findings: Finding[]): number {
  return findings.filter(isActionableFinding).length;
}

export function countTransformerCompatible(findings: Finding[]): number {
  return findings.filter(isTransformerCompatible).length;
}

export function countDryRunPassed(findings: Finding[]): number {
  return findings.filter(isDryRunPassed).length;
}
