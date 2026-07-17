import type { FindingsPayload } from "@/lib/findings/types";
import { nanoid } from "nanoid";
import {
  QUICK_TRIAGE_FETCH_BUDGET_MS,
  QUICK_TRIAGE_ANALYSIS_BUDGET_MS,
  QUICK_TRIAGE_OVERALL_BUDGET_MS,
  QUICK_TRIAGE_MAX_FILES_INSPECTED,
} from "./quick-triage-budget";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { runKnipFallback } from "@/lib/findings/fallback/knip-fallback";
import { runAiSlopHeuristics } from "@/lib/findings/ai-slop-heuristics";
import { normalizeFindings } from "@/lib/findings/normalize-findings";
import { finalizeAnalyzerResult } from "@/lib/findings/analyzer-result";
import type { AnalyzerRunResult, FindingsPayload as FP, JscpdRawReport, MadgeRawReport } from "@/lib/findings/types";
import { isDemoRepoUrl } from "@/lib/demo/constants";
import { parseGitHubUrl } from "@/lib/github/parse-github-url";

export type QuickTriageCoverageMode = "bounded_quick_triage" | "partial" | "unavailable";

export interface QuickTriageStageTiming {
  stage: string;
  durationMs: number;
  ok: boolean;
  detail?: string;
}

export interface BoundedQuickTriageResult {
  findings: FindingsPayload;
  timings: QuickTriageStageTiming[];
  totalMs: number;
  status: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
  coverage: {
    mode: QuickTriageCoverageMode;
    filesInspected: number;
    maximumFiles: number;
    limitations: string[];
  };
  recommendedNextAction?: string;
}

async function withBudget<T>(
  stage: string,
  budgetMs: number,
  fn: () => Promise<T>,
  timings: QuickTriageStageTiming[],
  fallback: () => T
): Promise<T> {
  const started = Date.now();
  try {
    const value = await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error(`${stage}_budget_exceeded`)), budgetMs);
      }),
    ]);
    timings.push({ stage, durationMs: Date.now() - started, ok: true });
    return value;
  } catch (err) {
    timings.push({
      stage,
      durationMs: Date.now() - started,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
    return fallback();
  }
}

function emptyJscpd(): AnalyzerRunResult<JscpdRawReport> {
  return finalizeAnalyzerResult<JscpdRawReport>(
    "jscpd",
    "fallback",
    { duplicates: [] },
    "Skipped for bounded Quick Triage path.",
    0
  );
}

function emptyMadge(): AnalyzerRunResult<MadgeRawReport> {
  return finalizeAnalyzerResult<MadgeRawReport>(
    "madge",
    "fallback",
    { orphans: [], circular: [] },
    "Skipped for bounded Quick Triage path.",
    0
  );
}

function emptyFindings(repoUrl: string, branch?: string, scanId?: string): FindingsPayload {
  const parsed = parseGitHubUrl(repoUrl);
  const owner = parsed?.owner ?? "unknown";
  const name = parsed?.repo ?? "unknown";
  const resolvedBranch = branch ?? parsed?.branch ?? "main";
  return {
    scanId: scanId ?? `scan_${nanoid(12)}`,
    repo: {
      owner,
      name,
      branch: resolvedBranch,
      commitSha: "unavailable",
      url: repoUrl,
    },
    summary: {
      totalFindings: 0,
      duplicateClusters: 0,
      unusedFiles: 0,
      unusedDependencies: 0,
      unusedExports: 0,
      orphanPatterns: 0,
      slopSignals: 0,
      reviewRequired: 0,
      safeCandidates: 0,
      doNotTouch: 0,
    },
    duplicates: [],
    unused: { files: [], dependencies: [], exports: [] },
    orphans: [],
    slopSignals: [],
    riskBuckets: { safeDelete: [], reviewFirst: [], doNotTouch: [] },
    artifacts: { findingsJson: true },
    mode: isDemoRepoUrl(repoUrl) ? "demo" : "live",
    rawToolReports: {
      knip: finalizeAnalyzerResult("knip", "fallback", { issues: [] }, "unavailable", 0),
      jscpd: emptyJscpd(),
      madge: emptyMadge(),
    },
  };
}

/**
 * Bounded Quick Triage scanner — ZIP only, no install/build/tests, hard budgets.
 */
export async function runBoundedQuickTriageScan(
  repoUrl: string,
  branch?: string
): Promise<BoundedQuickTriageResult> {
  const timings: QuickTriageStageTiming[] = [];
  const overallStarted = Date.now();
  const scanId = `scan_${nanoid(12)}`;
  const limitations: string[] = [
    "Bounded Quick Triage: ZIP archive only, no dependency install, no build/tests.",
    "Native knip/jscpd/madge CLI skipped.",
  ];

  let workspace: Awaited<ReturnType<typeof prepareRepoWorkspace>> | null = null;
  let fetchFailed = false;

  try {
    workspace = await withBudget(
      "fetch_and_extract",
      QUICK_TRIAGE_FETCH_BUDGET_MS,
      () => prepareRepoWorkspace(repoUrl, branch),
      timings,
      () => {
        fetchFailed = true;
        return null as unknown as Awaited<ReturnType<typeof prepareRepoWorkspace>>;
      }
    );
  } catch {
    fetchFailed = true;
  }

  if (fetchFailed || !workspace) {
    limitations.push("Repository fetch exceeded budget or repository unavailable.");
    return {
      findings: emptyFindings(repoUrl, branch, scanId),
      timings,
      totalMs: Date.now() - overallStarted,
      status: "UNAVAILABLE",
      coverage: {
        mode: "unavailable",
        filesInspected: 0,
        maximumFiles: QUICK_TRIAGE_MAX_FILES_INSPECTED,
        limitations,
      },
      recommendedNextAction: "REQUEST_A2A_DEEP_CLEANUP",
    };
  }

  try {
    const remaining = Math.max(2_000, QUICK_TRIAGE_OVERALL_BUDGET_MS - (Date.now() - overallStarted));
    const analysisBudget = Math.min(QUICK_TRIAGE_ANALYSIS_BUDGET_MS, remaining);

    let analysisPartial = false;
    const analysis = await withBudget(
      "bounded_analysis",
      analysisBudget,
      async () => {
        const [knipReport, slopSignals] = await Promise.all([
          runKnipFallback(workspace!.rootDir),
          runAiSlopHeuristics(workspace!.rootDir),
        ]);
        return { knipReport, slopSignals };
      },
      timings,
      () => {
        analysisPartial = true;
        return { knipReport: { issues: [] }, slopSignals: [] };
      }
    );

    if (analysisPartial) {
      limitations.push("Analysis stage hit time budget — partial evidence only.");
    }

    const knipResult = finalizeAnalyzerResult(
      "knip",
      "fallback",
      analysis.knipReport,
      "Bounded Quick Triage uses import-graph fallback (no native knip CLI).",
      timings.find((t) => t.stage === "bounded_analysis")?.durationMs ?? 0
    );
    const jscpdResult = emptyJscpd();
    const madgeResult = emptyMadge();

    const normalizeStarted = Date.now();
    const findings = normalizeFindings({
      scanId,
      repo: workspace.repo,
      rootDir: workspace.rootDir,
      knip: analysis.knipReport,
      knipResult,
      jscpd: jscpdResult.report,
      jscpdResult,
      madge: madgeResult.report,
      madgeResult,
      slop: analysis.slopSignals,
      mode: isDemoRepoUrl(repoUrl) ? "demo" : "live",
    });
    timings.push({
      stage: "normalize",
      durationMs: Date.now() - normalizeStarted,
      ok: true,
    });

    const filesInspected = Math.min(
      findings.summary?.totalFindings ?? 0,
      QUICK_TRIAGE_MAX_FILES_INSPECTED
    );
    const status = analysisPartial || fetchFailed ? "PARTIAL" : "COMPLETE";

    return {
      findings,
      timings,
      totalMs: Date.now() - overallStarted,
      status,
      coverage: {
        mode: status === "PARTIAL" ? "partial" : "bounded_quick_triage",
        filesInspected,
        maximumFiles: QUICK_TRIAGE_MAX_FILES_INSPECTED,
        limitations,
      },
      recommendedNextAction:
        status === "PARTIAL" ? "REQUEST_A2A_DEEP_CLEANUP" : undefined,
    };
  } finally {
    await workspace.cleanup().catch(() => {});
  }
}
