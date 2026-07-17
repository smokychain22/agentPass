/**
 * Canonical cleanup eligibility — single source of truth for UI counts,
 * select-all, and Continue-to-cleanup gates.
 */
import type { Finding } from "./types";
import {
  isPhase1StructuralCandidate,
  resolvePhase1Plugin,
} from "@/lib/execution/fix-plugins/phase1-plugins";

export type RiskBucket = "SAFE" | "REVIEW" | "PROTECTED";

export interface CleanupEligibilitySignals {
  isVerified: boolean;
  riskBucket: RiskBucket;
  transformerAvailable: boolean;
  transformerPreflightPassed: boolean;
  producesRealChange: boolean;
  isProtected: boolean;
  isCleanupEligible: boolean;
}

function preflightClassification(finding: Finding): string | undefined {
  const signal = finding.evidence.signals.find((s) => s.startsWith("classification="));
  return signal?.slice("classification=".length);
}

export function riskBucketOf(finding: Finding): RiskBucket {
  if (finding.protected || finding.action === "do_not_touch") return "PROTECTED";
  if (finding.action === "safe_candidate") return "SAFE";
  return "REVIEW";
}

export function isVerifiedFinding(finding: Finding): boolean {
  if (finding.confidenceTier === "verified") return true;
  if (finding.confidenceTier === "high_confidence") return true;
  // Native analyzer evidence without fallback / suppressed tiers counts as verified for eligibility.
  if (finding.sourceMode === "fallback" || finding.source.endsWith("_fallback")) return false;
  if (finding.confidenceTier === "suppressed" || finding.confidenceTier === "needs_review") {
    return false;
  }
  return finding.sourceMode === "native" || finding.sourceMode === undefined;
}

export function isTransformerAvailable(finding: Finding): boolean {
  const plugin = resolvePhase1Plugin(finding);
  if (plugin.id === "review_only") return false;
  return isPhase1StructuralCandidate(finding);
}

export function isTransformerPreflightPassed(finding: Finding): boolean {
  return preflightClassification(finding) === "actionable_candidate";
}

export function producesRealChange(finding: Finding): boolean {
  return isTransformerPreflightPassed(finding);
}

export function isProtectedFinding(finding: Finding): boolean {
  return Boolean(finding.protected) || finding.action === "do_not_touch" || riskBucketOf(finding) === "PROTECTED";
}

/**
 * isCleanupEligible =
 *   isVerified
 *   AND riskBucket == SAFE
 *   AND transformerAvailable
 *   AND transformerPreflightPassed
 *   AND producesRealChange
 *   AND NOT isProtected
 */
export function getCleanupEligibilitySignals(finding: Finding): CleanupEligibilitySignals {
  const isVerified = isVerifiedFinding(finding);
  const riskBucket = riskBucketOf(finding);
  const transformerAvailable = isTransformerAvailable(finding);
  const transformerPreflightPassed = isTransformerPreflightPassed(finding);
  const producesChange = producesRealChange(finding);
  const isProtected = isProtectedFinding(finding);

  const isCleanupEligible =
    isVerified &&
    riskBucket === "SAFE" &&
    transformerAvailable &&
    transformerPreflightPassed &&
    producesChange &&
    !isProtected;

  return {
    isVerified,
    riskBucket,
    transformerAvailable,
    transformerPreflightPassed,
    producesRealChange: producesChange,
    isProtected,
    isCleanupEligible,
  };
}

export function isCleanupEligible(finding: Finding): boolean {
  return getCleanupEligibilitySignals(finding).isCleanupEligible;
}

export function countCleanupEligible(findings: Finding[]): number {
  return findings.filter(isCleanupEligible).length;
}

/**
 * Checkbox enablement for a finding row — keyed only by stable finding identity
 * and canonical preflight eligibility. Never by list index, active filter, or risk label alone.
 */
export function isFindingCheckboxEnabled(finding: Finding): boolean {
  return isCleanupEligible(finding);
}

/** Safe-candidate bucket rows for selection UI (stable ID → enabled). */
export function safeCandidateSelectionRows(findings: Finding[]): Array<{
  findingId: string;
  enabled: boolean;
  action: Finding["action"];
}> {
  return findings
    .filter((f) => f.action === "safe_candidate")
    .map((f) => ({
      findingId: f.id,
      enabled: isFindingCheckboxEnabled(f),
      action: f.action,
    }));
}

export function assertCleanupEligibleInvariant(
  summaryCleanupEligibleCount: number,
  findings: Finding[]
): void {
  const computed = countCleanupEligible(findings);
  if (summaryCleanupEligibleCount !== computed) {
    throw new Error(
      `Invariant: summaryCleanupEligibleCount ${summaryCleanupEligibleCount} !== filtered ${computed}`
    );
  }
}
