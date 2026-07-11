import type { Finding } from "@/lib/findings/types";
import {
  isPhase1AutoFix,
  isPhase1StructuralCandidate,
  resolvePhase1Plugin,
} from "@/lib/execution/fix-plugins/phase1-plugins";
import { isAnalyzerAvailableForFindingType } from "./analyzer-availability";

export function findingPreflightClassification(finding: Finding): string | undefined {
  const signal = finding.evidence.signals.find((s) => s.startsWith("classification="));
  return signal?.slice("classification=".length);
}

/** Plugin claims it understands this finding type (structural only — not cleanup-eligible). */
export function isPluginRegistered(finding: Finding): boolean {
  return isPhase1AutoFix(finding);
}

/**
 * Strict eligibility: native analyzer evidence + dry-run produced a real content change.
 */
export function isEligibleFinding(finding: Finding): boolean {
  return isActionableFinding(finding);
}

/** @deprecated Use isEligibleFinding — strict mode requires preflight proof, not plugin registration. */
export function isTransformerCompatible(finding: Finding): boolean {
  return isEligibleFinding(finding);
}

/** Transformer produced modified content that differs from original at scan time. */
export function isTransformedFinding(finding: Finding): boolean {
  return findingPreflightClassification(finding) === "actionable_candidate";
}

/** @deprecated Use isTransformedFinding */
export function isDryRunPassed(finding: Finding): boolean {
  return isTransformedFinding(finding);
}

/**
 * Eligible for Quick Cleanup execution — requires native analyzer, dry-run proof, and structural evidence.
 */
export function isActionableFinding(finding: Finding): boolean {
  if (!isTransformedFinding(finding)) return false;
  const plugin = resolvePhase1Plugin(finding);
  if (plugin.id === "review_only") return false;
  if (!isPhase1StructuralCandidate(finding)) return false;
  if (finding.source.endsWith("_fallback") || finding.sourceMode === "fallback") return false;
  return true;
}

export function countActionableFindings(findings: Finding[]): number {
  return findings.filter(isActionableFinding).length;
}

export function countEligibleFindings(findings: Finding[]): number {
  return findings.filter(isEligibleFinding).length;
}

/** @deprecated Use countEligibleFindings */
export function countTransformerCompatible(findings: Finding[]): number {
  return countEligibleFindings(findings);
}

export function countTransformedFindings(findings: Finding[]): number {
  return findings.filter(isTransformedFinding).length;
}

/** @deprecated Use countTransformedFindings */
export function countDryRunPassed(findings: Finding[]): number {
  return countTransformedFindings(findings);
}

export function countPluginRegistered(findings: Finding[]): number {
  return findings.filter(isPluginRegistered).length;
}
