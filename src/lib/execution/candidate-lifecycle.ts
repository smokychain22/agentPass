import type { Finding, FindingType } from "@/lib/findings/types";
import type { FixPreflightResult } from "./fix-preflight";
import type { Phase1PluginId } from "./fix-plugins/phase1-plugins";
import { isPhase1AutoFix } from "./fix-plugins/phase1-plugins";
import { isActionablePreflight } from "./fix-preflight";
import { isActionableFinding, isDryRunPassed, isTransformerCompatible } from "@/lib/findings/actionability-signals";

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

export function auditFromPreflight(
  finding: Finding,
  preflight: FixPreflightResult,
  projectRoot?: string
): CandidateAuditRecord {
  const dryRunSucceeded = isActionablePreflight(preflight);
  return {
    findingId: finding.id,
    findingType: finding.type,
    filePath: finding.files[0] ?? finding.packageName,
    projectRoot,
    pluginId: preflight.pluginId,
    strategyIds: preflight.strategyId ? [preflight.strategyId] : [],
    sourceFound: preflight.sourceLocated,
    sourceHashMatched: preflight.sourceHashMatches,
    dryRunSucceeded,
    proposedSourceChanged: preflight.dryRunChangedSource,
    proposedDiffGenerated: preflight.diffGenerated,
    patchValidated: false,
    verificationSupported: preflight.requiredVerificationSupported,
    retained: false,
    blockerCode: dryRunSucceeded ? undefined : blockerCodeFromPreflight(preflight),
    blockerMessage: preflight.blocker,
  };
}

export function countLifecycleStages(findings: Finding[]): {
  transformerCompatible: number;
  dryRunPassed: number;
} {
  return {
    transformerCompatible: findings.filter(isTransformerCompatible).length,
    dryRunPassed: findings.filter(isDryRunPassed).length,
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

export function formatBlockerBreakdown(audits: CandidateAuditRecord[]): string {
  const compatible = audits.length;
  const dryRunOk = audits.filter((a) => a.dryRunSucceeded).length;
  const retained = audits.filter((a) => a.retained).length;
  const blockers = summarizeBlockers(audits);
  const parts: string[] = [
    `${compatible} transformer-compatible finding(s)`,
    `${dryRunOk} dry-run successful`,
    `${retained} verified change(s) retained`,
  ];
  const blockerParts = Object.entries(blockers)
    .filter(([, n]) => n > 0)
    .map(([code, n]) => `${n} ${code.replace(/_/g, " ")}`);
  if (blockerParts.length) {
    parts.push(blockerParts.join("; "));
  }
  if (retained === 0) {
    parts.push("0 verified changes retained");
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

  for (const finding of findings.filter(isTransformerCompatible)) {
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

export { isPhase1AutoFix, isTransformerCompatible, isDryRunPassed, isActionableFinding };
