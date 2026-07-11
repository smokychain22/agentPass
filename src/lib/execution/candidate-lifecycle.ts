import type { Finding, FindingType } from "@/lib/findings/types";
import type { FixPreflightResult } from "./fix-preflight";
import type { Phase1PluginId } from "./fix-plugins/phase1-plugins";
import { isPhase1AutoFix } from "./fix-plugins/phase1-plugins";
import { isActionablePreflight } from "./fix-preflight";
import { isActionableFinding, isEligibleFinding, isTransformedFinding } from "@/lib/findings/actionability-signals";

export type BlockerCode =
  | "source_not_found"
  | "source_hash_mismatch"
  | "unsupported_syntax"
  | "transform_noop"
  | "plugin_not_implemented"
  | "plugin_strategy_missing"
  | "fallback_evidence_unconfirmed"
  | "protected_path"
  | "diff_generation_failed"
  | "patch_validation_failed"
  | "verification_unavailable"
  | "verification_regression"
  | "workspace_write_failed"
  | "stale_snapshot"
  | "dry_run_failed"
  | "not_attempted";

export interface CandidateAuditRecord {
  findingId: string;
  findingType: FindingType;
  filePath?: string;
  projectRoot?: string;
  pluginId: Phase1PluginId | "review_only";
  strategyIds: string[];
  sourceFound: boolean;
  sourceHashMatched: boolean;
  /** Passed strict scan-time preflight (actionable candidate). */
  scanEligible: boolean;
  /** Transformer was invoked in the cleanup workspace. */
  transformAttempted: boolean;
  /** Execution produced a non-empty source modification. */
  contentChanged: boolean;
  /** @deprecated Use transformAttempted + contentChanged */
  dryRunSucceeded: boolean;
  proposedSourceChanged: boolean;
  proposedDiffGenerated: boolean;
  patchValidated: boolean;
  verificationSupported: boolean;
  retained: boolean;
  blockerCode?: BlockerCode;
  blockerMessage?: string;
}

export function blockerCodeFromPreflight(preflight: FixPreflightResult): BlockerCode | undefined {
  if (preflight.classification === "actionable_candidate") return undefined;
  const blocker = (preflight.blocker ?? "").toLowerCase();
  if (blocker.includes("protected")) return "protected_path";
  if (blocker.includes("hash mismatch") || blocker.includes("stale")) return "source_hash_mismatch";
  if (
    blocker.includes("could not produce") ||
    blocker.includes("no valid source modification") ||
    blocker.includes("noop")
  ) {
    return "transform_noop";
  }
  if (blocker.includes("dry-run") || blocker.includes("dry run")) return "dry_run_failed";
  if (blocker.includes("strategy")) return "plugin_strategy_missing";
  if (blocker.includes("unsupported") || blocker.includes("no supported")) {
    return "plugin_not_implemented";
  }
  if (!preflight.sourceLocated) return "source_not_found";
  if (!preflight.strategyAvailable) return "plugin_strategy_missing";
  return "transform_noop";
}

export function blockerCodeFromAttemptReason(reason: string, displayReason?: string): BlockerCode {
  const text = `${reason} ${displayReason ?? ""}`.toLowerCase();
  if (text.includes("diff_generation_failed") || text.includes("unified diff is empty")) {
    return "diff_generation_failed";
  }
  if (text.includes("patch validation")) return "patch_validation_failed";
  if (text.includes("verification") || text.includes("regression")) {
    return "verification_regression";
  }
  if (text.includes("hash")) return "source_hash_mismatch";
  if (text.includes("workspace_path_mismatch")) return "workspace_write_failed";
  if (text.includes("write_failed")) return "workspace_write_failed";
  if (text.includes("noop") || text.includes("no diff") || text.includes("identical source")) {
    return "transform_noop";
  }
  return "transform_noop";
}

export function mergeExecutionIntoAudit(
  audit: CandidateAuditRecord,
  attempt?: {
    status: string;
    reason: string;
    displayReason: string;
    patchValidation?: { status: string };
    modifiedSources?: Record<string, string>;
  }
): CandidateAuditRecord {
  if (attempt?.status === "retained") {
    return {
      ...audit,
      transformAttempted: true,
      contentChanged: true,
      dryRunSucceeded: true,
      patchValidated: attempt.patchValidation?.status === "passed",
      retained: true,
      blockerCode: undefined,
      blockerMessage: undefined,
    };
  }

  if (attempt) {
    const executionDiffGenerated = Object.keys(attempt.modifiedSources ?? {}).length > 0;
    return {
      ...audit,
      transformAttempted: true,
      contentChanged: executionDiffGenerated,
      dryRunSucceeded: false,
      patchValidated: attempt.patchValidation?.status === "passed",
      retained: false,
      blockerCode: blockerCodeFromAttemptReason(attempt.reason, attempt.displayReason),
      blockerMessage: attempt.displayReason,
    };
  }

  if (audit.scanEligible) {
    return {
      ...audit,
      transformAttempted: false,
      contentChanged: false,
      dryRunSucceeded: false,
      blockerCode: "not_attempted",
      blockerMessage:
        "Eligible finding was not processed — cleanup run stopped at the configured fix/attempt limit.",
    };
  }

  return {
    ...audit,
    transformAttempted: false,
    dryRunSucceeded: false,
  };
}

export function auditFromPreflight(
  finding: Finding,
  preflight: FixPreflightResult,
  projectRoot?: string
): CandidateAuditRecord {
  const scanEligible = isActionablePreflight(preflight);
  return {
    findingId: finding.id,
    findingType: finding.type,
    filePath: finding.files[0] ?? finding.packageName,
    projectRoot,
    pluginId: preflight.pluginId,
    strategyIds: preflight.strategyId ? [preflight.strategyId] : [],
    sourceFound: preflight.sourceLocated,
    sourceHashMatched: preflight.sourceHashMatches,
    scanEligible,
    transformAttempted: false,
    contentChanged: false,
    dryRunSucceeded: false,
    proposedSourceChanged: preflight.dryRunChangedSource,
    proposedDiffGenerated: preflight.diffGenerated,
    patchValidated: false,
    verificationSupported: preflight.requiredVerificationSupported,
    retained: false,
    blockerCode: scanEligible ? undefined : blockerCodeFromPreflight(preflight),
    blockerMessage: preflight.blocker,
  };
}

export function countLifecycleStages(findings: Finding[]): {
  eligibleFindings: number;
  transformedFindings: number;
  transformerCompatible: number;
  dryRunPassed: number;
} {
  const eligible = findings.filter(isEligibleFinding).length;
  const transformed = findings.filter(isTransformedFinding).length;
  return {
    eligibleFindings: eligible,
    transformedFindings: transformed,
    transformerCompatible: eligible,
    dryRunPassed: transformed,
  };
}

export function summarizeBlockers(audits: CandidateAuditRecord[]): Record<BlockerCode, number> {
  const counts = {} as Record<BlockerCode, number>;
  for (const audit of audits) {
    if (!audit.blockerCode || audit.retained) continue;
    counts[audit.blockerCode] = (counts[audit.blockerCode] ?? 0) + 1;
  }
  return counts;
}

export function isCleanupEligibleAudit(audit: CandidateAuditRecord): boolean {
  return (
    audit.scanEligible &&
    audit.blockerCode !== "transform_noop" &&
    audit.blockerCode !== "plugin_not_implemented" &&
    audit.blockerMessage !== "Dependency entry was not found in the selected manifest."
  );
}

export function summarizeCleanupAttempts(audits: CandidateAuditRecord[]): {
  eligible: number;
  ineligible: number;
  preflightChecked: number;
  executed: number;
  /** @deprecated Use executed */
  attempted: number;
  generatedChanges: number;
  noop: number;
  failed: number;
  failedExecutions: number;
  notAttempted: number;
  validated: number;
  verified: number;
} {
  const preflightChecked = audits.length;
  const eligible = audits.filter(isCleanupEligibleAudit).length;
  const ineligible = preflightChecked - eligible;
  const executed = audits.filter(
    (a) => a.transformAttempted && isCleanupEligibleAudit(a)
  ).length;
  const generatedChanges = audits.filter((a) => a.contentChanged && a.transformAttempted).length;
  const noop = audits.filter(
    (a) => a.transformAttempted && a.blockerCode === "transform_noop"
  ).length;
  const failed = audits.filter(
    (a) =>
      a.transformAttempted &&
      a.blockerCode !== "transform_noop" &&
      a.blockerCode !== "not_attempted" &&
      !a.retained
  ).length;
  const notAttempted = audits.filter((a) => a.blockerCode === "not_attempted").length;
  const validated = audits.filter((a) => a.retained && a.patchValidated).length;
  return {
    eligible,
    ineligible,
    preflightChecked,
    executed,
    attempted: executed,
    generatedChanges,
    noop,
    failed,
    failedExecutions: failed,
    notAttempted,
    validated,
    verified: 0,
  };
}

export function formatBlockerBreakdown(audits: CandidateAuditRecord[]): string {
  const stats = summarizeCleanupAttempts(audits);
  const blockers = summarizeBlockers(audits);
  const parts: string[] = [
    `Detected findings: ${stats.preflightChecked}`,
    `Eligible findings: ${stats.eligible}`,
    `Ineligible findings: ${stats.ineligible}`,
    `Executed findings: ${stats.executed}`,
    `Generated file operations: ${stats.generatedChanges}`,
    `No-op: ${stats.noop}`,
    `Failed: ${stats.failed}`,
    `Not attempted: ${stats.notAttempted}`,
    `Validated: ${stats.validated}`,
    `Verified: ${stats.verified}`,
  ];
  const blockerParts = Object.entries(blockers)
    .filter(([, n]) => n > 0)
    .map(([code, n]) => `${n} ${code.replace(/_/g, " ")}`);
  if (blockerParts.length) {
    parts.push(blockerParts.join("; "));
  }
  return parts.join(". ") + ".";
}

export async function auditTransformerCompatibleFindings(
  rootDir: string,
  findings: Finding[],
  options?: { runPreflight?: (finding: Finding) => Promise<FixPreflightResult> }
): Promise<{ audits: CandidateAuditRecord[]; preflights: Map<string, FixPreflightResult> }> {
  const { runFixPreflight } = await import("./fix-preflight");
  const { isPhase1StructuralCandidate } = await import("./fix-plugins/phase1-plugins");
  const preflights = new Map<string, FixPreflightResult>();
  const audits: CandidateAuditRecord[] = [];

  for (const finding of findings.filter(isEligibleFinding)) {
    if (!isPhase1StructuralCandidate(finding)) {
      audits.push({
        findingId: finding.id,
        findingType: finding.type,
        filePath: finding.files[0] ?? finding.packageName,
        projectRoot: finding.projectRoot,
        pluginId: "review_only",
        strategyIds: [],
        sourceFound: false,
        sourceHashMatched: false,
        scanEligible: false,
        transformAttempted: false,
        contentChanged: false,
        dryRunSucceeded: false,
        proposedSourceChanged: false,
        proposedDiffGenerated: false,
        patchValidated: false,
        verificationSupported: false,
        retained: false,
        blockerCode: "plugin_strategy_missing",
        blockerMessage: "Finding lacks structural evidence required for dry-run.",
      });
      continue;
    }
    const preflight = options?.runPreflight
      ? await options.runPreflight(finding)
      : await runFixPreflight(rootDir, finding);
    preflights.set(finding.id, preflight);
    audits.push(auditFromPreflight(finding, preflight, finding.projectRoot));
  }

  return { audits, preflights };
}

export { isPhase1AutoFix, isEligibleFinding as isTransformerCompatible, isTransformedFinding as isDryRunPassed, isActionableFinding };
