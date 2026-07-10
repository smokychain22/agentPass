import { execa } from "execa";
import type { Finding } from "@/lib/findings/types";
import type { VerifyCheckResult } from "@/lib/jobs/types";
import { classifyFindingActionability } from "@/lib/cleanup/actionability";
import {
  isPhase1AutoFix,
  isPhase1StructuralCandidate,
  phase1EligibilityReason,
  resolvePhase1Plugin,
  type Phase1PluginId,
} from "./fix-plugins/phase1-plugins";
import {
  buildBaselineReport,
  formatComparisonLabel,
  type BaselineVerificationReport,
} from "./baseline-verification";
import {
  runProfiledBaselineChecks,
  buildProfiledReport,
} from "./verification-profiles";
import { applyPhase1Fix } from "./fix-plugins/apply-phase1-fix";
import {
  FREE_CANDIDATE_ATTEMPT_LIMIT,
  FREE_RETAINED_FIX_LIMIT,
  MAX_STRATEGIES_PER_FINDING,
} from "./constants";
import {
  buildEligibilityEvidence,
  formatRejectionReason,
  type CandidateDecisionRecord,
} from "./candidate-decision";
import { listStrategiesForFinding } from "./fix-strategies";
import {
  deriveAttemptProductOutcome,
  formatProductOutcomeLabel,
  attemptConsumesCandidateLimit,
  type ProductOutcome,
} from "./outcomes";
import { CleanupRunStateMachine } from "./cleanup-run-state";

export interface FixAttemptResult {
  finding: Finding;
  status: "retained" | "skipped" | "rejected";
  productOutcome: ProductOutcome;
  exactReason: string;
  reason: string;
  displayReason: string;
  pluginId: string;
  strategyId: string;
  expectedFix: string;
  eligibilityReason: string;
  unifiedDiff: string;
  changedPaths: string[];
  originalSources: Record<string, string>;
  modifiedSources: Record<string, string>;
  patchValidation?: { status: string; error?: string };
  baselineReport?: BaselineVerificationReport;
  checks: VerifyCheckResult[];
  comparison: Array<{ name: string; outcome: string; exitCode: number | null }>;
  rollbackStatus: "completed" | "not_needed" | "failed" | "pending";
  decision: CandidateDecisionRecord;
}

export interface OneFixLoopResult {
  stateMachine: CleanupRunStateMachine;
  attempts: FixAttemptResult[];
  retained: FixAttemptResult[];
  decisions: CandidateDecisionRecord[];
  unifiedDiff: string;
  changedPaths: string[];
  metrics: {
    selected: number;
    evaluated: number;
    retained: number;
    skipped: number;
    rejected: number;
    rolledBack: number;
    unsupported: number;
    notAttempted: number;
  };
}

function countDiffLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ")) continue;
    if (line.startsWith("+")) added += 1;
    if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

export { countDiffLines };

const PLUGIN_PRIORITY: Record<Phase1PluginId, number> = {
  remove_temp_file: 0,
  remove_unused_import: 1,
  remove_unused_dependency: 2,
  review_only: 99,
};

function sortPhase1Candidates(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const actionableA = a.evidence.signals.includes("classification=actionable_candidate") ? 0 : 1;
    const actionableB = b.evidence.signals.includes("classification=actionable_candidate") ? 0 : 1;
    if (actionableA !== actionableB) return actionableA - actionableB;
    const pa = PLUGIN_PRIORITY[resolvePhase1Plugin(a).id];
    const pb = PLUGIN_PRIORITY[resolvePhase1Plugin(b).id];
    if (pa !== pb) return pa - pb;
    const singleA = a.files.length === 1 ? 0 : 1;
    const singleB = b.files.length === 1 ? 0 : 1;
    if (singleA !== singleB) return singleA - singleB;
    return b.confidence - a.confidence;
  });
}

async function rollbackWorkspace(rootDir: string): Promise<"completed" | "failed"> {
  try {
    await execa("git", ["checkout", "--", "."], { cwd: rootDir, reject: false });
    await execa("git", ["clean", "-fd"], { cwd: rootDir, reject: false });
    return "completed";
  } catch {
    return "failed";
  }
}

function recordAttempt(
  decisions: CandidateDecisionRecord[],
  attempts: FixAttemptResult[],
  candidateIndex: number,
  input: Omit<FixAttemptResult, "displayReason" | "decision" | "productOutcome" | "exactReason">
): void {
  const productOutcome = deriveAttemptProductOutcome({
    internalStatus: input.status,
    reason: input.reason,
    pluginId: input.pluginId,
    comparison: input.comparison,
  });
  const exactReason = formatRejectionReason({
    status: input.status,
    reason: input.reason,
    productOutcome,
    comparison: input.comparison,
    patchValidation: input.patchValidation,
    rollbackStatus: input.rollbackStatus,
  });
  const displayReason =
    input.status === "retained"
      ? formatProductOutcomeLabel("verified_fix")
      : exactReason;
  const { added, removed } = countDiffLines(input.unifiedDiff);
  const hasRealChange =
    Boolean(input.unifiedDiff) &&
    input.unifiedDiff.includes("diff --git") &&
    added + removed > 0;
  const decision: CandidateDecisionRecord = {
    candidateId: `cand_${candidateIndex + 1}`,
    findingId: input.finding.id,
    pluginId: input.pluginId,
    strategyId: input.strategyId,
    state:
      input.status === "retained"
        ? "retained"
        : input.status === "rejected"
          ? "rejected"
          : "skipped",
    actionability: classifyFindingActionability(input.finding),
    eligibilityEvidence: buildEligibilityEvidence(input.finding),
    generatedChange: input.unifiedDiff
      ? {
          changedFiles: input.changedPaths,
          unifiedDiff: input.unifiedDiff,
          additions: added,
          deletions: removed,
        }
      : undefined,
    patchValidation: input.patchValidation,
    baseline: input.baselineReport,
    comparison: input.comparison,
    verificationComparison: input.comparison,
    finalDecision: input.status === "retained" ? "retained" : input.status,
    productOutcome,
    exactReason,
    rejectionReason: displayReason,
    rollbackStatus: input.rollbackStatus,
    checks: input.checks,
  };
  decisions.push(decision);
  attempts.push({
    ...input,
    originalSources: hasRealChange ? input.originalSources : {},
    modifiedSources: hasRealChange ? input.modifiedSources : {},
    productOutcome,
    exactReason,
    displayReason,
    decision,
  });
}

export async function runOneFixAtATimeLoop(
  rootDir: string,
  findings: Finding[],
  options?: {
    maxFixes?: number;
    maxAttempts?: number;
    stateMachine?: CleanupRunStateMachine;
    /** Skip npm typecheck/lint/build — retain fixes after diff validation only. */
    verificationLevel?: "full" | "diff_only";
  }
): Promise<OneFixLoopResult> {
  const sm = options?.stateMachine ?? new CleanupRunStateMachine();
  const maxFixes = options?.maxFixes ?? FREE_RETAINED_FIX_LIMIT;
  const maxAttempts = options?.maxAttempts ?? FREE_CANDIDATE_ATTEMPT_LIMIT;
  const diffOnly = options?.verificationLevel === "diff_only";

  sm.emit("modeling_repository");
  sm.emit("ranking_candidates");
  sm.emit("selecting_finding");

  const candidates = sortPhase1Candidates(
    findings.filter((f) => isPhase1AutoFix(f) || isPhase1StructuralCandidate(f))
  );

  const attempts: FixAttemptResult[] = [];
  const decisions: CandidateDecisionRecord[] = [];
  const retainedDiffs: string[] = [];
  const allChanged: string[] = [];
  let retainedCount = 0;
  let attemptCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const finding = candidates[i];
    if (retainedCount >= maxFixes) {
      decisions.push({
        candidateId: `cand_${i + 1}`,
        findingId: finding.id,
        pluginId: resolvePhase1Plugin(finding).id,
        state: "not_attempted",
        eligibilityEvidence: buildEligibilityEvidence(finding),
        finalDecision: "skipped",
        productOutcome: "no_safe_action",
        exactReason: "A verified fix was already retained.",
        rejectionReason: "A verified fix was already retained.",
        rollbackStatus: "not_needed",
        checks: [],
      });
      continue;
    }
    if (attemptCount >= maxAttempts) {
      decisions.push({
        candidateId: `cand_${i + 1}`,
        findingId: finding.id,
        pluginId: resolvePhase1Plugin(finding).id,
        state: "not_attempted",
        eligibilityEvidence: buildEligibilityEvidence(finding),
        finalDecision: "skipped",
        productOutcome: "no_safe_action",
        exactReason: `Attempt limit (${maxAttempts}) reached.`,
        rejectionReason: `Attempt limit (${maxAttempts}) reached.`,
        rollbackStatus: "not_needed",
        checks: [],
      });
      continue;
    }

    const plugin = resolvePhase1Plugin(finding);
    const eligibilityReason = phase1EligibilityReason(finding);
    const actionability = classifyFindingActionability(finding);

    if (plugin.id === "review_only" || actionability === "evidence_only") {
      sm.emit("rejected", finding.id);
      recordAttempt(decisions, attempts, attemptCount, {
        finding,
        status: "rejected",
        reason: eligibilityReason,
        pluginId: plugin.id,
        strategyId: "none",
        expectedFix: plugin.label,
        eligibilityReason,
        unifiedDiff: "",
        changedPaths: [],
        originalSources: {},
        modifiedSources: {},
        checks: [],
        comparison: [],
        rollbackStatus: "not_needed",
      });
      attemptCount += 1;
      continue;
    }

    const strategies = listStrategiesForFinding(finding, plugin.id);
    let candidateSucceeded = false;

    for (let si = 0; si < strategies.length && si < MAX_STRATEGIES_PER_FINDING; si++) {
      if (retainedCount >= maxFixes || attemptCount >= maxAttempts) break;

      const strategy = strategies[si];
      sm.emit("generating_change", `${plugin.id}:${strategy.id}`);

      try {
        let baseline: Awaited<ReturnType<typeof runProfiledBaselineChecks>> | undefined;
        if (!diffOnly) {
          sm.emit("running_baseline", finding.id);
          baseline = await runProfiledBaselineChecks(rootDir, plugin.id, "baseline");
        }

        const applied = await applyPhase1Fix(rootDir, finding, strategy.id);

        if (!applied.unifiedDiff) {
          sm.emit("rolling_back", "No diff generated");
          const rollbackStatus = await rollbackWorkspace(rootDir);
          const productOutcome = deriveAttemptProductOutcome({
            internalStatus: "skipped",
            reason: "transform_noop: No diff was generated for this fix.",
            pluginId: plugin.id,
          });
          recordAttempt(decisions, attempts, attemptCount, {
            finding,
            status: "skipped",
            reason: "transform_noop: No diff was generated for this fix.",
            pluginId: plugin.id,
            strategyId: strategy.id,
            expectedFix: applied.expectedFix,
            eligibilityReason,
            unifiedDiff: "",
            changedPaths: [],
            originalSources: {},
            modifiedSources: {},
            checks: [],
            comparison: [],
            rollbackStatus,
          });
          if (attemptConsumesCandidateLimit(productOutcome)) attemptCount += 1;
          sm.emit("trying_next_candidate", strategy.id);
          continue;
        }

        sm.emit("validating_change");
        const patchValidation = {
          status:
            applied.unifiedDiff.includes("diff --git") && applied.changedPaths.length > 0
              ? "passed"
              : "failed",
          error:
            applied.unifiedDiff.includes("diff --git")
              ? undefined
              : "No valid unified diff produced.",
        };
        const checks: VerifyCheckResult[] = [
          {
            name: "Patch validation",
            command: "unified diff inspection",
            status: patchValidation.status === "passed" ? "passed" : "failed",
            exitCode: patchValidation.status === "passed" ? 0 : 1,
            durationMs: 0,
            stdoutSummary:
              patchValidation.status === "passed"
                ? `${applied.changedPaths.length} path(s) changed in diff.`
                : "",
            stderrSummary: patchValidation.error ?? "",
          },
        ];

        if (patchValidation.status !== "passed") {
          sm.emit("rolling_back", patchValidation.error ?? "patch validation failed");
          const rollbackStatus = await rollbackWorkspace(rootDir);
          const productOutcome = deriveAttemptProductOutcome({
            internalStatus: "skipped",
            reason: patchValidation.error ?? "Patch validation failed.",
            pluginId: plugin.id,
          });
          recordAttempt(decisions, attempts, attemptCount, {
            finding,
            status: "skipped",
            reason: patchValidation.error ?? "Patch validation failed.",
            pluginId: plugin.id,
            strategyId: strategy.id,
            expectedFix: applied.expectedFix,
            eligibilityReason,
            unifiedDiff: "",
            changedPaths: [],
            originalSources: {},
            modifiedSources: {},
            patchValidation,
            checks,
            comparison: [],
            rollbackStatus,
          });
          if (attemptConsumesCandidateLimit(productOutcome)) attemptCount += 1;
          sm.emit("trying_next_candidate", strategy.id);
          continue;
        }

        if (diffOnly) {
          sm.emit("retaining_change", finding.id);
          retainedDiffs.push(applied.unifiedDiff);
          allChanged.push(...applied.changedPaths);
          retainedCount += 1;
          candidateSucceeded = true;
          recordAttempt(decisions, attempts, attemptCount, {
            finding,
            status: "retained",
            reason: "Fix retained after diff validation (quick patch mode).",
            pluginId: plugin.id,
            strategyId: strategy.id,
            expectedFix: applied.expectedFix,
            eligibilityReason,
            unifiedDiff: applied.unifiedDiff,
            changedPaths: applied.changedPaths,
            originalSources: applied.originalSources,
            modifiedSources: applied.modifiedSources,
            patchValidation,
            checks,
            comparison: [],
            rollbackStatus: "not_needed",
          });
          attemptCount += 1;
          break;
        }

        sm.emit("running_targeted_checks");
        sm.emit("running_repository_checks");
        const after = await runProfiledBaselineChecks(rootDir, plugin.id, "after");
        const baselineReport = buildProfiledReport(baseline!, after);
        const introduced = baselineReport.compared.filter(
          (c) => c.outcome === "new_failure_introduced"
        );

        const comparison = baselineReport.compared.map((c) => ({
          name: c.name,
          outcome: formatComparisonLabel(c.outcome),
          exitCode: c.exitCode,
        }));

        for (const c of baselineReport.compared) {
          checks.push({
            name: `${c.name} (comparison)`,
            command: c.command,
            status:
              c.outcome === "new_failure_introduced"
                ? "failed"
                : c.outcome === "passed_before_and_after" ||
                    c.outcome === "pre_existing_failure_resolved"
                  ? "passed"
                  : c.outcome === "failed_before_and_after" ||
                      c.outcome === "pre_existing_failure"
                    ? "passed"
                    : "skipped",
            exitCode: c.exitCode,
            durationMs: c.durationMs,
            stdoutSummary: c.stdoutSummary,
            stderrSummary: `${formatComparisonLabel(c.outcome)}`,
          });
        }

        if (introduced.length > 0) {
          sm.emit("rolling_back", `introduced failure: ${introduced.map((c) => c.name).join(", ")}`);
          const rollbackStatus = await rollbackWorkspace(rootDir);
          recordAttempt(decisions, attempts, attemptCount, {
            finding,
            status: "skipped",
            reason: `Verification introduced new failure in: ${introduced.map((c) => c.name).join(", ")}`,
            pluginId: plugin.id,
            strategyId: strategy.id,
            expectedFix: applied.expectedFix,
            eligibilityReason,
            unifiedDiff: applied.unifiedDiff,
            changedPaths: applied.changedPaths,
            originalSources: applied.originalSources,
            modifiedSources: applied.modifiedSources,
            patchValidation,
            baselineReport,
            checks,
            comparison,
            rollbackStatus,
          });
          attemptCount += 1;
          sm.emit("trying_next_candidate", strategy.id);
          continue;
        }

        sm.emit("retaining_change", finding.id);
        retainedDiffs.push(applied.unifiedDiff);
        allChanged.push(...applied.changedPaths);
        retainedCount += 1;
        candidateSucceeded = true;
        recordAttempt(decisions, attempts, attemptCount, {
          finding,
          status: "retained",
          reason: "Fix verified and retained.",
          pluginId: plugin.id,
          strategyId: strategy.id,
          expectedFix: applied.expectedFix,
          eligibilityReason,
          unifiedDiff: applied.unifiedDiff,
          changedPaths: applied.changedPaths,
          originalSources: applied.originalSources,
          modifiedSources: applied.modifiedSources,
          patchValidation,
          baselineReport,
          checks,
          comparison,
          rollbackStatus: "not_needed",
        });
        attemptCount += 1;
        break;
      } catch (err) {
        sm.emit("rolling_back", err instanceof Error ? err.message : "fix failed");
        const rollbackStatus = await rollbackWorkspace(rootDir);
        const msg = err instanceof Error ? err.message : "Fix attempt failed.";
        const productOutcome = deriveAttemptProductOutcome({
          internalStatus: "skipped",
          reason: msg,
          pluginId: plugin.id,
        });
        recordAttempt(decisions, attempts, attemptCount, {
          finding,
          status: "skipped",
          reason: msg,
          pluginId: plugin.id,
          strategyId: strategy.id,
          expectedFix: plugin.label,
          eligibilityReason,
          unifiedDiff: "",
          changedPaths: [],
          originalSources: {},
          modifiedSources: {},
          checks: [],
          comparison: [],
          rollbackStatus,
        });
        if (attemptConsumesCandidateLimit(productOutcome)) attemptCount += 1;
        sm.emit("trying_next_candidate", strategy.id);
      }
    }

    if (!candidateSucceeded && strategies.length === 0) {
      recordAttempt(decisions, attempts, attemptCount, {
        finding,
        status: "rejected",
        reason: "No supported strategies for this finding.",
        pluginId: plugin.id,
        strategyId: "none",
        expectedFix: plugin.label,
        eligibilityReason,
        unifiedDiff: "",
        changedPaths: [],
        originalSources: {},
        modifiedSources: {},
        checks: [],
        comparison: [],
        rollbackStatus: "not_needed",
      });
      attemptCount += 1;
    }
  }

  const retained = attempts.filter((a) => a.status === "retained");
  sm.emit(retained.length > 0 ? "completed" : attempts.length > 0 ? "failed" : "completed");

  const notAttempted = decisions.filter((d) => d.state === "not_attempted").length;
  const skippedAttempts = attempts.filter((a) => a.status === "skipped");
  const rolledBack = skippedAttempts.filter(
    (a) => a.productOutcome === "rolled_back_regression"
  ).length;
  const unsupported = skippedAttempts.filter(
    (a) => a.productOutcome === "unsupported_transformation"
  ).length;

  return {
    stateMachine: sm,
    attempts,
    retained,
    decisions,
    unifiedDiff: retainedDiffs.join("\n"),
    changedPaths: allChanged,
    metrics: {
      selected: candidates.length,
      evaluated: attempts.length,
      retained: retained.length,
      skipped: skippedAttempts.length,
      rejected: attempts.filter((a) => a.status === "rejected").length,
      rolledBack,
      unsupported,
      notAttempted,
    },
  };
}
