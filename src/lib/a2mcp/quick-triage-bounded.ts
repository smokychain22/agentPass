import { nanoid } from "nanoid";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { runKnipFallback } from "@/lib/findings/fallback/knip-fallback";
import { runAiSlopHeuristics } from "@/lib/findings/ai-slop-heuristics";
import { normalizeFindings } from "@/lib/findings/normalize-findings";
import { finalizeAnalyzerResult } from "@/lib/findings/analyzer-result";
import type { AnalyzerRunResult, FindingsPayload, JscpdRawReport, MadgeRawReport } from "@/lib/findings/types";
import { isDemoRepoUrl } from "@/lib/demo/constants";

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
}

const FETCH_BUDGET_MS = 15_000;
const ANALYSIS_BUDGET_MS = 25_000;
const OVERALL_BUDGET_MS = 45_000;

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
    { circular: [], orphans: [] },
    "Skipped for bounded Quick Triage path.",
    0
  );
}

/**
 * Bounded Quick Triage scanner:
 * - GitHub ZIP archive only (no git clone)
 * - no dependency install / build / tests
 * - knip fallback import-graph + heuristics only
 * - hard per-stage budgets so the paid request stays under the platform timeout
 */
export async function runBoundedQuickTriageScan(
  repoUrl: string,
  branch?: string
): Promise<BoundedQuickTriageResult> {
  const timings: QuickTriageStageTiming[] = [];
  const overallStarted = Date.now();
  const scanId = `scan_${nanoid(12)}`;

  const workspace = await withBudget(
    "fetch_and_extract",
    FETCH_BUDGET_MS,
    () => prepareRepoWorkspace(repoUrl, branch),
    timings,
    () => {
      throw new Error("Repository fetch exceeded Quick Triage budget.");
    }
  );

  try {
    const remaining = Math.max(5_000, OVERALL_BUDGET_MS - (Date.now() - overallStarted));
    const analysisBudget = Math.min(ANALYSIS_BUDGET_MS, remaining);

    const analysis = await withBudget(
      "bounded_analysis",
      analysisBudget,
      async () => {
        const [knipReport, slopSignals] = await Promise.all([
          runKnipFallback(workspace.rootDir),
          runAiSlopHeuristics(workspace.rootDir),
        ]);
        return { knipReport, slopSignals };
      },
      timings,
      () => ({ knipReport: { issues: [] }, slopSignals: [] })
    );

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

    return {
      findings,
      timings,
      totalMs: Date.now() - overallStarted,
    };
  } finally {
    await workspace.cleanup().catch(() => {});
  }
}
