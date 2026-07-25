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
import { buildFullRepositoryInventory, type FullRepositoryInventory } from "@/lib/scanner/inventory";

export type QuickTriageCoverageMode = "bounded_quick_triage" | "partial" | "unavailable";
export type QuickTriageCoverageState = "complete" | "partial" | "unavailable";

export interface QuickTriageStageTiming {
  stage: string;
  durationMs: number;
  ok: boolean;
  detail?: string;
}

export interface QuickTriageSkippedClassification {
  kind: string;
  count: number;
  reason: string;
}

export interface QuickTriageCoverage {
  mode: QuickTriageCoverageMode;
  state: QuickTriageCoverageState;
  commitSha: string;
  filesDiscovered: number;
  filesInspected: number;
  supportedFilesAnalyzed: number;
  filesSkipped: number;
  skippedClassifications: QuickTriageSkippedClassification[];
  maximumFiles: number;
  limitations: string[];
}

export interface BoundedQuickTriageResult {
  findings: FindingsPayload;
  timings: QuickTriageStageTiming[];
  totalMs: number;
  status: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
  coverage: QuickTriageCoverage;
  recommendedNextAction?: string;
}

export function emptyCoverage(
  mode: QuickTriageCoverageMode,
  state: QuickTriageCoverageState,
  limitations: string[],
  commitSha = "unavailable"
): QuickTriageCoverage {
  return {
    mode,
    state,
    commitSha,
    filesDiscovered: 0,
    filesInspected: 0,
    supportedFilesAnalyzed: 0,
    filesSkipped: 0,
    skippedClassifications: [],
    maximumFiles: QUICK_TRIAGE_MAX_FILES_INSPECTED,
    limitations,
  };
}

/**
 * Real repository inventory-derived coverage — never inferred from finding count.
 * A repository with zero findings can still report a nonzero number of files inspected.
 */
export function buildTriageCoverage(input: {
  inventory: FullRepositoryInventory;
  commitSha: string;
  partial: boolean;
}): QuickTriageCoverage {
  const { inventory, commitSha, partial } = input;

  const supportedFiles = inventory.files.filter((f) => f.kind === "supported_source");
  const boundedByCap = supportedFiles.length > QUICK_TRIAGE_MAX_FILES_INSPECTED;
  const supportedFilesAnalyzed = Math.min(supportedFiles.length, QUICK_TRIAGE_MAX_FILES_INSPECTED);
  const filesDiscovered = inventory.files.length;
  const filesInspected = supportedFilesAnalyzed;
  const filesSkipped = filesDiscovered - filesInspected;

  const kindCounts = new Map<string, number>();
  for (const file of inventory.files) {
    if (file.kind === "supported_source") continue;
    kindCounts.set(file.kind, (kindCounts.get(file.kind) ?? 0) + 1);
  }
  for (const dir of inventory.skippedDirectories) {
    kindCounts.set(dir.kind, (kindCounts.get(dir.kind) ?? 0) + 1);
  }

  const skippedClassifications: QuickTriageSkippedClassification[] = Array.from(
    kindCounts.entries()
  ).map(([kind, count]) => ({
    kind,
    count,
    reason: `${kind} files are not part of the bounded Quick Triage supported-source scope.`,
  }));

  if (supportedFiles.length > QUICK_TRIAGE_MAX_FILES_INSPECTED) {
    skippedClassifications.push({
      kind: "supported_source_over_cap",
      count: supportedFiles.length - QUICK_TRIAGE_MAX_FILES_INSPECTED,
      reason: `Supported source files beyond the ${QUICK_TRIAGE_MAX_FILES_INSPECTED}-file bounded Quick Triage cap were not inspected.`,
    });
  }

  const limitations = [
    "Bounded Quick Triage: ZIP archive only, no dependency install, no build/tests.",
    "Native knip/jscpd/madge CLI skipped.",
  ];
  if (supportedFiles.length > QUICK_TRIAGE_MAX_FILES_INSPECTED) {
    limitations.push(
      `Repository has ${supportedFiles.length} supported source files; only the first ${QUICK_TRIAGE_MAX_FILES_INSPECTED} were inspected. Request an A2A deep clean up for full coverage.`
    );
  }
  if (partial) {
    limitations.push("Analysis stage hit time budget — partial evidence only.");
  }

  const state: QuickTriageCoverageState = partial || boundedByCap ? "partial" : "complete";

  return {
    mode: state === "partial" ? "partial" : "bounded_quick_triage",
    state,
    commitSha,
    filesDiscovered,
    filesInspected,
    supportedFilesAnalyzed,
    filesSkipped,
    skippedClassifications,
    maximumFiles: QUICK_TRIAGE_MAX_FILES_INSPECTED,
    limitations,
  };
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
  branch?: string,
  commitSha?: string
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
      () => prepareRepoWorkspace(repoUrl, branch, undefined, commitSha),
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
      coverage: emptyCoverage("unavailable", "unavailable", limitations, commitSha ?? "unavailable"),
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

    let inventory: FullRepositoryInventory;
    let inventoryFailed = false;
    try {
      inventory = await buildFullRepositoryInventory(workspace.rootDir);
    } catch {
      inventoryFailed = true;
      inventory = { files: [], allRelativePaths: [], topLevelFolders: [], skippedDirectories: [], totalBytes: 0 };
    }
    if (inventoryFailed) {
      limitations.push("Repository inventory could not be built — coverage is unavailable, not zero.");
    }

    const coverage = buildTriageCoverage({
      inventory,
      commitSha: workspace.repo.commitSha ?? "unavailable",
      partial: analysisPartial || fetchFailed || inventoryFailed,
    });
    // Fold the fetch/analysis limitations gathered above into the inventory-derived coverage.
    for (const line of limitations) {
      if (!coverage.limitations.includes(line)) coverage.limitations.push(line);
    }

    const status = coverage.state === "partial" ? "PARTIAL" : "COMPLETE";

    return {
      findings,
      timings,
      totalMs: Date.now() - overallStarted,
      status,
      coverage: { ...coverage, mode: status === "PARTIAL" ? "partial" : "bounded_quick_triage" },
      recommendedNextAction:
        status === "PARTIAL" ? "REQUEST_A2A_DEEP_CLEANUP" : undefined,
    };
  } finally {
    await workspace.cleanup().catch(() => {});
  }
}
