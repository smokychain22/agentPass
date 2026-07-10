import { nanoid } from "nanoid";
import type { Finding, FindingsPayload } from "@/lib/findings/types";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import {
  FREE_CLEANUP_LIMIT,
  isAutoFixEligible,
  listAutoFixEligible,
  listReviewPlanEligible,
} from "@/lib/cleanup/eligibility";
import { classifyFindingsForPatch } from "@/lib/patch-kit/safe-delete-classifier";
import {
  detectRepoContextFromFindings,
  generateRegressionChecklist,
} from "@/lib/patch-kit/generate-regression-checklist";
import { generateCursorPrompt } from "@/lib/patch-kit/generate-cursor-prompt";
import type { VerifyCheckResult } from "@/lib/jobs/types";
import { runOneFixAtATimeLoop, countDiffLines } from "./one-fix-at-a-time";
import {
  FREE_CANDIDATE_ATTEMPT_LIMIT,
  QUICK_CLEANUP_RETAINED_FIX_LIMIT,
} from "./constants";
import { formatRejectionReason } from "./candidate-decision";
import {
  buildNoSafeActionSummary,
  deriveRunFinalStatus,
  formatProductOutcomeLabel,
  type ProductOutcome,
  type RunFinalStatus,
} from "./outcomes";
import { computeHealthImpact } from "./health-impact";
import {
  hashPatchContent,
  hashVerification,
  type ExecutionReceipt,
} from "@/lib/operator/sign-receipt";
import { summarizeBaselineReport } from "./baseline-verification";
import {
  resolvePhase1Plugin,
  isPhase1StructuralCandidate,
} from "@/lib/execution/fix-plugins/phase1-plugins";
import { enrichFindingsWithPreflight, isActionableFinding } from "@/lib/findings/enrich-preflight";
import { CleanupRunStateMachine, type CleanupStateTransition } from "./cleanup-run-state";

export interface FileChange {
  path: string;
  findingIds: string[];
}

export interface FreeCleanupResult {
  id: string;
  mode: "auto_fix" | "review_plan";
  selectedFindings: Finding[];
  skippedCount: number;
  fileChanges: FileChange[];
  unifiedDiff: string;
  patchStatus: "validated" | "review_plan_only" | "failed";
  patchValidation?: { status: string; error?: string };
  verification: {
    status: "passed" | "failed" | "partial" | "not_run";
    checks: VerifyCheckResult[];
    limitations: string[];
    baselineSummary?: string[];
  };
  fixLoop: {
    selected: number;
    verified: number;
    skipped: number;
    rejected: number;
    rolledBack: number;
    unsupported: number;
    reviewReady: number;
    attempts: Array<{
      findingId: string;
      title: string;
      status: string;
      productOutcome: ProductOutcome;
      exactReason: string;
      reason: string;
      displayReason: string;
      pluginId: string;
      strategyId: string;
      expectedFix: string;
      eligibilityReason: string;
      changedPaths: string[];
      originalSources: Record<string, string>;
      modifiedSources: Record<string, string>;
      comparison: Array<{ name: string; outcome: string; exitCode: number | null }>;
      rollbackStatus: string;
    }>;
    candidateDecisions: import("./candidate-decision").CandidateDecisionRecord[];
    evaluated: number;
    notAttempted: number;
  };
  stateTransitions: CleanupStateTransition[];
  proof: {
    selectedFindingId?: string;
    changedFiles: string[];
    linesAdded: number;
    linesRemoved: number;
    executedCommands: Array<{
      name: string;
      command: string;
      exitCode: number | null;
      status: string;
    }>;
    finalDecision: RunFinalStatus | "review_plan";
    productOutcome: ProductOutcome | RunFinalStatus | "review_plan";
    commitSha: string;
    githubModified: false;
  };
  healthImpact?: import("./health-impact").HealthImpact;
  metrics: {
    issuesSelected: number;
    issuesChanged: number;
    filesChanged: number;
    linesAdded: number;
    linesRemoved: number;
  };
  artifacts: {
    reportMd: string;
    cleanupPromptMd: string;
    regressionChecklistMd: string;
    selectedFindingsJson: string;
  };
  limitations: string[];
  verifiedLabel: string;
  receipt: ExecutionReceipt;
}

function flattenAll(payload: FindingsPayload): Finding[] {
  return [
    ...payload.duplicates,
    ...payload.unused.files,
    ...payload.unused.dependencies,
    ...payload.unused.exports,
    ...payload.orphans,
    ...payload.slopSignals,
  ];
}

function buildReviewReport(findings: Finding[], payload: FindingsPayload, note: string): string {
  const lines = [
    "# RepoDiet Cleanup Report",
    "",
    `Repository: ${payload.repo.owner}/${payload.repo.name}`,
    `Branch: ${payload.repo.branch}`,
    "",
    "## Selected findings",
    "",
  ];
  for (const f of findings) {
    lines.push(`- **${f.title}** (${f.type}) — ${f.files.join(", ") || f.packageName}`);
    lines.push(`  - ${f.reason}`);
    lines.push(`  - Plugin: ${resolvePhase1Plugin(f).label}`);
  }
  lines.push("", "## Note", "", note);
  return lines.join("\n");
}

function selectedPayload(payload: FindingsPayload, selected: Finding[]): FindingsPayload {
  const ids = new Set(selected.map((f) => f.id));
  const keep = (items: Finding[]) => items.filter((f) => ids.has(f.id));
  return {
    ...payload,
    duplicates: keep(payload.duplicates),
    unused: {
      files: keep(payload.unused.files),
      dependencies: keep(payload.unused.dependencies),
      exports: keep(payload.unused.exports),
    },
    orphans: keep(payload.orphans),
    slopSignals: keep(payload.slopSignals),
  };
}

export async function runFreeCleanupCore(
  payload: FindingsPayload,
  options?: { findingIds?: string[]; maxFixes?: number }
): Promise<FreeCleanupResult> {
  const maxFixes = options?.maxFixes ?? FREE_CLEANUP_LIMIT;
  const all = flattenAll(payload);
  const id = `cleanup_${nanoid(12)}`;
  const limitations: string[] = [];

  let selected: Finding[];
  let mode: "auto_fix" | "review_plan";

  if (options?.findingIds?.length) {
    const idSet = new Set(options.findingIds.slice(0, maxFixes));
    const picked = all.filter((f) => idSet.has(f.id));
    const auto = picked.filter(isAutoFixEligible);
    selected = auto.length > 0 ? auto.slice(0, maxFixes) : picked.slice(0, maxFixes);
    mode = auto.length > 0 ? "auto_fix" : "review_plan";
  } else {
    const autoPool = all.filter(isAutoFixEligible);
    if (autoPool.length > 0) {
      selected = autoPool;
      mode = "auto_fix";
    } else {
      selected = listReviewPlanEligible(all).slice(0, maxFixes);
      mode = "review_plan";
    }
  }

  const skippedCount = all.length - selected.length;
  const context = detectRepoContextFromFindings(payload);
  const subset = selectedPayload(payload, selected);
  const buckets = classifyFindingsForPatch(subset);
  const { markdown: regressionChecklistMd } = generateRegressionChecklist(
    context,
    context.packageManager
  );
  const cleanupPromptMd = generateCursorPrompt(payload, buckets, context);

  const commitSha = payload.repo.commitSha ?? "unknown";

  if (mode === "review_plan" || selected.length === 0) {
    const receipt: ExecutionReceipt = {
      taskId: id,
      repository: `${payload.repo.owner}/${payload.repo.name}`,
      commitSha,
      findingIds: selected.map((f) => f.id),
      patchHash: hashPatchContent(""),
      verificationHash: hashVerification([]),
      status: "review_plan",
      timestamp: new Date().toISOString(),
    };
    return {
      id,
      mode: "review_plan",
      selectedFindings: selected,
      skippedCount,
      fileChanges: [],
      unifiedDiff: "",
      patchStatus: "review_plan_only",
      verification: {
        status: "not_run",
        checks: [],
        limitations: ["No automatic changes generated."],
      },
      fixLoop: {
        selected: 0,
        verified: 0,
        skipped: 0,
        rejected: 0,
        rolledBack: 0,
        unsupported: 0,
        reviewReady: selected.length,
        evaluated: 0,
        notAttempted: 0,
        attempts: [],
        candidateDecisions: [],
      },
      stateTransitions: [{ state: "completed", at: new Date().toISOString(), detail: "review_plan" }],
      proof: {
        changedFiles: [],
        linesAdded: 0,
        linesRemoved: 0,
        executedCommands: [],
        finalDecision: "review_ready_change",
        productOutcome: "review_ready_change",
        commitSha,
        githubModified: false,
      },
      metrics: {
        issuesSelected: selected.length,
        issuesChanged: 0,
        filesChanged: 0,
        linesAdded: 0,
        linesRemoved: 0,
      },
      artifacts: {
        reportMd: buildReviewReport(
          selected,
          payload,
          "No safe automatic patch was generated. RepoDiet created a conservative review plan instead."
        ),
        cleanupPromptMd,
        regressionChecklistMd,
        selectedFindingsJson: JSON.stringify(selected, null, 2),
      },
      limitations: [
        "No findings met RepoDiet's automatic-fix safety threshold.",
        "Review plan only — no code changes were applied.",
      ],
      verifiedLabel: "Review plan prepared",
      receipt,
    };
  }

  const sm = new CleanupRunStateMachine();
  sm.emit("preparing_workspace");

  const repoUrl =
    payload.repo.url ?? `https://github.com/${payload.repo.owner}/${payload.repo.name}`;
  const workspace = await prepareRepoWorkspace(repoUrl, payload.repo.branch);

  try {
    const structuralPool = selected.filter(
      (f) => isPhase1StructuralCandidate(f) || isAutoFixEligible(f)
    );
    const preflightPool = structuralPool.length > 0 ? structuralPool : selected;
    const { findings: repreflighted } = await enrichFindingsWithPreflight(
      workspace.rootDir,
      preflightPool
    );
    const actionableCandidates = repreflighted.filter(isActionableFinding);
    const loopCandidates =
      actionableCandidates.length > 0 ? actionableCandidates : repreflighted;

    const loop = await runOneFixAtATimeLoop(workspace.rootDir, loopCandidates, {
      maxFixes,
      maxAttempts: FREE_CANDIDATE_ATTEMPT_LIMIT,
      stateMachine: sm,
    });
    const { added, removed } = countDiffLines(loop.unifiedDiff);

    const allChecks = loop.attempts.flatMap((a) => a.checks);
    const retained = loop.metrics.retained > 0;
    const patchStatus = retained ? "validated" : "failed";

    const primaryAttempt =
      loop.retained[0] ?? loop.attempts.find((a) => a.status === "retained") ?? loop.attempts[0];
    const baselineSummary = primaryAttempt?.baselineReport
      ? summarizeBaselineReport(primaryAttempt.baselineReport)
      : undefined;

    const primaryRejected =
      loop.attempts.find((a) => a.status === "skipped" || a.status === "rejected") ??
      loop.attempts[0];
    const runStatus = deriveRunFinalStatus({
      retainedCount: loop.metrics.retained,
      attemptCount: loop.attempts.length,
      mode: "auto_fix",
    });
    const attemptOutcomes = loop.attempts.map((a) => a.productOutcome);
    const headlineReason = retained
      ? formatProductOutcomeLabel("verified_fix")
      : buildNoSafeActionSummary({
          evaluated: loop.attempts.length,
          retained: loop.metrics.retained,
          outcomes: attemptOutcomes,
        }) ||
        (primaryRejected
          ? primaryRejected.displayReason
          : formatRejectionReason({
              status: "skipped",
              reason: "No eligible candidates were evaluated.",
              productOutcome: "no_safe_action",
              rollbackStatus: "not_needed",
            }));

    if (!retained && loop.attempts.length > 0) {
      limitations.push(
        `RepoDiet evaluated ${loop.attempts.length} candidate(s) but retained 0 verified change(s).`
      );
    }

    const fileChanges: FileChange[] = loop.changedPaths.map((rel) => ({
      path: rel,
      findingIds: selected.filter((f) => f.files.includes(rel)).map((f) => f.id),
    }));

    const verificationStatus: FreeCleanupResult["verification"]["status"] = retained
      ? "passed"
      : loop.attempts.length > 0
        ? "partial"
        : "not_run";

    const finalDecision = runStatus;
    const healthImpact = computeHealthImpact(loop.retained);

    const receipt: ExecutionReceipt = {
      taskId: id,
      repository: `${payload.repo.owner}/${payload.repo.name}`,
      commitSha,
      findingIds: loop.retained.map((r) => r.finding.id),
      patchHash: hashPatchContent(loop.unifiedDiff),
      verificationHash: hashVerification(allChecks),
      status: retained ? "verified" : "partial",
      timestamp: new Date().toISOString(),
    };

    return {
      id,
      mode: "auto_fix",
      selectedFindings:
        loop.retained.length > 0 ? loop.retained.map((r) => r.finding) : selected.slice(0, maxFixes),
      skippedCount,
      fileChanges,
      unifiedDiff: loop.unifiedDiff,
      patchStatus,
      patchValidation: loop.retained[0]?.patchValidation,
      verification: {
        status: verificationStatus,
        checks: allChecks,
        limitations,
        baselineSummary,
      },
      fixLoop: {
        selected: loop.metrics.selected,
        verified: loop.metrics.retained,
        skipped: loop.metrics.skipped,
        rejected: loop.metrics.rejected,
        rolledBack: loop.metrics.rolledBack,
        unsupported: loop.metrics.unsupported,
        reviewReady: 0,
        evaluated: loop.metrics.evaluated,
        notAttempted: loop.metrics.notAttempted,
        attempts: loop.attempts.map((a) => ({
          findingId: a.finding.id,
          title: a.finding.title,
          status: a.status,
          productOutcome: a.productOutcome,
          exactReason: a.exactReason,
          reason: a.reason,
          displayReason: a.displayReason,
          pluginId: a.pluginId,
          strategyId: a.strategyId,
          expectedFix: a.expectedFix,
          eligibilityReason: a.eligibilityReason,
          changedPaths: a.changedPaths,
          originalSources: a.originalSources,
          modifiedSources: a.modifiedSources,
          comparison: a.comparison,
          rollbackStatus: a.rollbackStatus,
        })),
        candidateDecisions: loop.decisions,
      },
      stateTransitions: sm.transitions,
      proof: {
        selectedFindingId: primaryAttempt?.finding.id,
        changedFiles: loop.changedPaths,
        linesAdded: added,
        linesRemoved: removed,
        executedCommands: allChecks.map((c) => ({
          name: c.name,
          command: c.command,
          exitCode: c.exitCode,
          status: c.status,
        })),
        finalDecision,
        productOutcome: retained ? "verified_fix" : finalDecision,
        commitSha,
        githubModified: false,
      },
      healthImpact,
      metrics: {
        issuesSelected: selected.length,
        issuesChanged: loop.metrics.retained,
        filesChanged: loop.changedPaths.length,
        linesAdded: added,
        linesRemoved: removed,
      },
      artifacts: {
        reportMd: buildReviewReport(
          selected,
          payload,
          loop.changedPaths.length > 0
            ? `${loop.metrics.retained} verified fix(es), ${loop.changedPaths.length} file(s) changed in isolated workspace. Your GitHub repository was not modified.`
            : "No safe file changes were retained after verification."
        ),
        cleanupPromptMd,
        regressionChecklistMd,
        selectedFindingsJson: JSON.stringify(selected, null, 2),
      },
      limitations,
      verifiedLabel: headlineReason,
      receipt,
    };
  } finally {
    await workspace.cleanup();
  }
}
