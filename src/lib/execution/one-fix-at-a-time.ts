import { execa } from "execa";
import type { Finding } from "@/lib/findings/types";
import type { VerifyCheckResult } from "@/lib/jobs/types";
import {
  isPhase1AutoFix,
  phase1EligibilityReason,
  resolvePhase1Plugin,
  type Phase1PluginId,
} from "./fix-plugins/phase1-plugins";
import {
  buildBaselineReport,
  formatComparisonLabel,
  runFullBaselineChecks,
  type BaselineCheck,
  type BaselineVerificationReport,
} from "./baseline-verification";
import { applyPhase1Fix, type AppliedFix } from "./fix-plugins/apply-phase1-fix";
import { CleanupRunStateMachine } from "./cleanup-run-state";

export interface FixAttemptResult {
  finding: Finding;
  status: "retained" | "skipped" | "rejected";
  reason: string;
  pluginId: string;
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
}

export interface OneFixLoopResult {
  stateMachine: CleanupRunStateMachine;
  attempts: FixAttemptResult[];
  retained: FixAttemptResult[];
  unifiedDiff: string;
  changedPaths: string[];
  metrics: {
    selected: number;
    retained: number;
    skipped: number;
    rejected: number;
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
    const pa = PLUGIN_PRIORITY[resolvePhase1Plugin(a).id];
    const pb = PLUGIN_PRIORITY[resolvePhase1Plugin(b).id];
    if (pa !== pb) return pa - pb;
    const singleA = a.files.length === 1 ? 0 : 1;
    const singleB = b.files.length === 1 ? 0 : 1;
    if (singleA !== singleB) return singleA - singleB;
    return b.confidence - a.confidence;
  });
}

async function rollbackWorkspace(rootDir: string): Promise<void> {
  await execa("git", ["checkout", "--", "."], { cwd: rootDir, reject: false });
  await execa("git", ["clean", "-fd"], { cwd: rootDir, reject: false });
}

export async function runOneFixAtATimeLoop(
  rootDir: string,
  findings: Finding[],
  options?: { maxFixes?: number; stateMachine?: CleanupRunStateMachine }
): Promise<OneFixLoopResult> {
  const sm = options?.stateMachine ?? new CleanupRunStateMachine();
  const maxFixes = options?.maxFixes ?? 1;

  sm.emit("selecting_finding");
  const candidates = sortPhase1Candidates(findings.filter(isPhase1AutoFix));
  const maxAttempts = Math.max(maxFixes * 5, 5);

  const attempts: FixAttemptResult[] = [];
  const retainedDiffs: string[] = [];
  const allChanged: string[] = [];
  let retainedCount = 0;

  for (const finding of candidates.slice(0, maxAttempts)) {
    if (retainedCount >= maxFixes) break;
    const plugin = resolvePhase1Plugin(finding);
    const eligibilityReason = phase1EligibilityReason(finding);

    if (plugin.id === "review_only") {
      sm.emit("rejected", finding.id);
      attempts.push({
        finding,
        status: "rejected",
        reason: eligibilityReason,
        pluginId: plugin.id,
        expectedFix: plugin.label,
        eligibilityReason,
        unifiedDiff: "",
        changedPaths: [],
        originalSources: {},
        modifiedSources: {},
        checks: [],
        comparison: [],
      });
      continue;
    }

    try {
      sm.emit("running_baseline", finding.id);
      const baseline = await runFullBaselineChecks(rootDir, "baseline");

      sm.emit("generating_change", plugin.id);
      const applied: AppliedFix = await applyPhase1Fix(rootDir, finding);

      if (!applied.unifiedDiff) {
        sm.emit("skipped", "No diff generated");
        attempts.push({
          finding,
          status: "skipped",
          reason: "No diff was generated for this fix.",
          pluginId: plugin.id,
          expectedFix: applied.expectedFix,
          eligibilityReason,
          unifiedDiff: "",
          changedPaths: [],
          originalSources: applied.originalSources,
          modifiedSources: applied.modifiedSources,
          checks: [],
          comparison: [],
        });
        await rollbackWorkspace(rootDir);
        continue;
      }

      sm.emit("validating_patch");
      const patchValidation = {
        status:
          applied.unifiedDiff.includes("diff --git") && applied.changedPaths.length > 0
            ? "passed"
            : "failed",
        error:
          applied.unifiedDiff.includes("diff --git") ? undefined : "No valid unified diff produced.",
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
        sm.emit("skipped", patchValidation.error ?? "patch validation failed");
        await rollbackWorkspace(rootDir);
        attempts.push({
          finding,
          status: "skipped",
          reason: patchValidation.error ?? "Patch validation failed.",
          pluginId: plugin.id,
          expectedFix: applied.expectedFix,
          eligibilityReason,
          unifiedDiff: applied.unifiedDiff,
          changedPaths: applied.changedPaths,
          originalSources: applied.originalSources,
          modifiedSources: applied.modifiedSources,
          patchValidation,
          checks,
          comparison: [],
        });
        continue;
      }

      sm.emit("running_verification");
      const after = await runFullBaselineChecks(rootDir, "after");
      const baselineReport = buildBaselineReport(baseline, after);
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
              : c.outcome === "passed_before_and_after" || c.outcome === "pre_existing_failure_resolved"
                ? "passed"
                : c.outcome === "failed_before_and_after" || c.outcome === "pre_existing_failure"
                  ? "passed"
                  : "skipped",
          exitCode: c.exitCode,
          durationMs: c.durationMs,
          stdoutSummary: c.stdoutSummary,
          stderrSummary: `${formatComparisonLabel(c.outcome)}`,
        });
      }

      if (introduced.length > 0) {
        sm.emit("skipped", `introduced failure: ${introduced.map((c) => c.name).join(", ")}`);
        await rollbackWorkspace(rootDir);
        attempts.push({
          finding,
          status: "skipped",
          reason: `Verification introduced new failure in: ${introduced.map((c) => c.name).join(", ")}`,
          pluginId: plugin.id,
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
        });
        continue;
      }

      sm.emit("retained", finding.id);
      retainedDiffs.push(applied.unifiedDiff);
      allChanged.push(...applied.changedPaths);
      retainedCount += 1;
      attempts.push({
        finding,
        status: "retained",
        reason: "Fix verified and retained.",
        pluginId: plugin.id,
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
      });
    } catch (err) {
      sm.emit("skipped", err instanceof Error ? err.message : "fix failed");
      await rollbackWorkspace(rootDir).catch(() => undefined);
      attempts.push({
        finding,
        status: "skipped",
        reason: err instanceof Error ? err.message : "Fix attempt failed.",
        pluginId: plugin.id,
        expectedFix: plugin.label,
        eligibilityReason,
        unifiedDiff: "",
        changedPaths: [],
        originalSources: {},
        modifiedSources: {},
        checks: [],
        comparison: [],
      });
    }
  }

  const retained = attempts.filter((a) => a.status === "retained");
  sm.emit(retained.length > 0 ? "completed" : attempts.length > 0 ? "failed" : "completed");

  return {
    stateMachine: sm,
    attempts,
    retained,
    unifiedDiff: retainedDiffs.join("\n"),
    changedPaths: allChanged,
    metrics: {
      selected: attempts.length,
      retained: retained.length,
      skipped: attempts.filter((a) => a.status === "skipped").length,
      rejected: attempts.filter((a) => a.status === "rejected").length,
    },
  };
}
