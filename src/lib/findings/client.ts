import type { FindingsPayload } from "./types";
import type { DeepScanStage } from "@/lib/deep-scan/types";
import {
  analysisError,
  createRequestId,
  normalizeFindingsClientError,
  type AnalysisErrorContract,
} from "./analysis-errors";
import { fetchPersistedFindings } from "@/lib/session/persist-session";

export type FindingsPhase =
  | "idle"
  | "queued"
  | "dispatching"
  | "dispatched"
  | "waiting_runner"
  | "claimed"
  | "preparing_archive"
  | "downloading_archive"
  | "archive_ready"
  | "inventory"
  | "resolving"
  | "graph"
  | "running_jscpd"
  | "running_knip"
  | "running_madge"
  | "running_heuristics"
  | "analyzers"
  | "normalizing"
  | "validating"
  | "persisting"
  | "baseline"
  | "ready"
  | "failed"
  | "worker_stalled";

export const FINDINGS_STEPS: { phase: FindingsPhase; label: string }[] = [
  { phase: "queued", label: "Queued" },
  { phase: "dispatching", label: "Starting secure analysis worker" },
  { phase: "dispatched", label: "GitHub worker requested" },
  { phase: "waiting_runner", label: "Waiting for GitHub Actions runner" },
  { phase: "claimed", label: "Claimed by GitHub runner" },
  { phase: "preparing_archive", label: "Preparing repository archive" },
  { phase: "downloading_archive", label: "Downloading commit-pinned source" },
  { phase: "archive_ready", label: "Archive ready" },
  { phase: "inventory", label: "Inventory" },
  { phase: "resolving", label: "Resolving projects" },
  { phase: "graph", label: "Building graph" },
  { phase: "running_jscpd", label: "Running jscpd" },
  { phase: "running_knip", label: "Running Knip" },
  { phase: "running_madge", label: "Running Madge" },
  { phase: "running_heuristics", label: "Running heuristics" },
  { phase: "analyzers", label: "Running analyzers" },
  { phase: "normalizing", label: "Normalizing findings" },
  { phase: "validating", label: "Validating evidence" },
  { phase: "persisting", label: "Persisting results" },
  { phase: "baseline", label: "Baseline verification" },
  { phase: "ready", label: "Ready" },
];

const STAGE_TO_PHASE: Record<string, FindingsPhase> = {
  QUEUED: "queued",
  DISPATCHING: "dispatching",
  DISPATCHED: "dispatched",
  WAITING_FOR_RUNNER: "waiting_runner",
  CLAIMED: "claimed",
  PREPARING_ARCHIVE: "preparing_archive",
  DOWNLOADING_ARCHIVE: "downloading_archive",
  ARCHIVE_READY: "archive_ready",
  INVENTORY: "inventory",
  RESOLVING_PROJECTS: "resolving",
  BUILDING_GRAPH: "graph",
  RUNNING_JSCpd: "running_jscpd",
  RUNNING_KNIP: "running_knip",
  RUNNING_MADGE: "running_madge",
  RUNNING_INTERNAL_HEURISTICS: "running_heuristics",
  RUNNING_ANALYZERS: "analyzers",
  NORMALIZING_FINDINGS: "normalizing",
  VALIDATING_EVIDENCE: "validating",
  PERSISTING_RESULTS: "persisting",
  BASELINE_VERIFICATION: "baseline",
  READY: "ready",
  COMPLETED: "ready",
  WORKER_STALLED: "worker_stalled",
  FAILED: "failed",
  FAILED_RETRYABLE: "failed",
  FAILED_TERMINAL: "failed",
  CANCELLED: "failed",
};

export function mapDeepScanStageToPhase(stage: string): FindingsPhase {
  return STAGE_TO_PHASE[stage] ?? "queued";
}

export function analyzerStageLabel(
  report: FindingsPayload["rawToolReports"][keyof FindingsPayload["rawToolReports"]]
): string {
  if (report.status === "ok") {
    return report.source === "knip" ? "Knip" : report.source === "jscpd" ? "jscpd" : "Madge";
  }
  if (report.status === "fallback") {
    if (report.source === "internal_import_graph") return "Unused-code fallback";
    if (report.source === "internal_duplicate_detector") return "Duplicate fallback";
    if (report.source === "internal_dependency_graph") return "Dependency-graph fallback";
    return "Fallback analyzer";
  }
  return "Analyzer failed";
}

export interface FindingsJobAccepted {
  accepted: true;
  jobId: string;
  taskId: string;
  status: string;
  stage: string;
  statusUrl: string;
  workerReady: boolean;
  dispatcherReady?: boolean;
  workerMode?: string;
  workflowRunId?: string;
  workflowRunUrl?: string;
  requestId: string;
  structureScanId: string;
  message?: string;
  requiredAction?: string;
}

export interface FindingsJobProgress {
  jobId: string;
  status: string;
  stage: DeepScanStage | string;
  workerReady?: boolean;
  dispatcherReady?: boolean;
  workerMode?: string;
  workflowRunId?: string;
  workflowRunUrl?: string;
  claimedBy?: string;
  workerHost?: string;
  workerIdentity?: string;
  findingsId?: string;
  graphId?: string;
  failureCode?: string;
  failureMessage?: string;
  statusHistory?: Array<{ stage: string; at: string; detail?: string }>;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  sourceCommit?: string;
  heartbeatAt?: string;
  stageStartedAt?: string;
  lastActivityAt?: string;
  progressMessage?: string;
  completedUnits?: number;
  totalUnits?: number;
  timingBreakdown?: Record<string, number>;
  progress?: {
    stage?: string;
    detail?: string;
    message?: string;
    updatedAt?: string;
    stageStartedAt?: string;
    lastActivityAt?: string;
    completedUnits?: number;
    totalUnits?: number;
  };
  leaseExpiresAt?: string;
  repositoryOwner?: string;
  repositoryName?: string;
}

const ANALYSIS_JOB_STORAGE_KEY = "repodiet.analysisJob.v1";

export function persistAnalysisJob(input: {
  structureScanId: string;
  jobId: string;
  statusUrl: string;
  requestId: string;
}): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ANALYSIS_JOB_STORAGE_KEY, JSON.stringify(input));
  } catch {
    /* ignore */
  }
}

export function loadPersistedAnalysisJob(structureScanId?: string): {
  structureScanId: string;
  jobId: string;
  statusUrl: string;
  requestId: string;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ANALYSIS_JOB_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      structureScanId: string;
      jobId: string;
      statusUrl: string;
      requestId: string;
    };
    if (structureScanId && parsed.structureScanId !== structureScanId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPersistedAnalysisJob(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(ANALYSIS_JOB_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export async function startDurableFindingsAnalysis(input: {
  structureScanId: string;
  repoUrl: string;
  branch?: string;
  sourceCommit?: string;
  projectRoot?: string;
}): Promise<FindingsJobAccepted> {
  const requestId = createRequestId();
  let res: Response;
  try {
    res = await fetch("/api/findings/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        structureScanId: input.structureScanId,
        repoUrl: input.repoUrl,
        branch: input.branch,
        sourceCommit: input.sourceCommit,
        projectRoot: input.projectRoot,
      }),
    });
  } catch (err) {
    throw normalizeFindingsClientError(err, {
      structureScanId: input.structureScanId,
      requestId,
    });
  }

  let json: Record<string, unknown>;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    throw normalizeFindingsClientError(err, {
      structureScanId: input.structureScanId,
      requestId,
    });
  }

  if (!res.ok && res.status !== 202) {
    throw analysisError({
      code: (typeof json.code === "string" ? json.code : "INTERNAL_ERROR") as AnalysisErrorContract["code"],
      message:
        typeof json.message === "string"
          ? json.message
          : typeof json.error === "string"
            ? json.error
            : `Findings enqueue failed (${res.status}).`,
      retryable: Boolean(json.retryable ?? (res.status >= 500 || res.status === 503)),
      requestId: typeof json.requestId === "string" ? json.requestId : requestId,
      structureScanId: input.structureScanId,
      jobId: typeof json.jobId === "string" ? json.jobId : undefined,
      statusUrl: typeof json.statusUrl === "string" ? json.statusUrl : undefined,
      requiredAction:
        typeof json.requiredAction === "string" ? json.requiredAction : "RETRY",
    });
  }

  const jobId = String(json.jobId ?? "");
  const statusUrl = String(json.statusUrl ?? `/api/deep-scans/${jobId}`);
  const accepted: FindingsJobAccepted = {
    accepted: true,
    jobId,
    taskId: String(json.taskId ?? jobId),
    status: String(json.status ?? "QUEUED"),
    stage: String(json.stage ?? "QUEUED"),
    statusUrl,
    workerReady: Boolean(json.workerReady),
    dispatcherReady: Boolean(json.dispatcherReady),
    workerMode: typeof json.workerMode === "string" ? json.workerMode : undefined,
    workflowRunId: typeof json.workflowRunId === "string" ? json.workflowRunId : undefined,
    workflowRunUrl: typeof json.workflowRunUrl === "string" ? json.workflowRunUrl : undefined,
    requestId: typeof json.requestId === "string" ? json.requestId : requestId,
    structureScanId: input.structureScanId,
    message: typeof json.message === "string" ? json.message : undefined,
    requiredAction:
      typeof json.requiredAction === "string" ? json.requiredAction : undefined,
  };

  persistAnalysisJob({
    structureScanId: input.structureScanId,
    jobId: accepted.jobId,
    statusUrl: accepted.statusUrl,
    requestId: accepted.requestId,
  });

  return accepted;
}

/** Max time the browser will wait in QUEUED with no claim before surfacing a delayed state. */
export const FINDINGS_MAX_QUEUE_WAIT_MS = 10 * 60_000;

export async function pollDurableFindingsJob(
  statusUrl: string,
  onProgress: (progress: FindingsJobProgress) => void,
  options?: { intervalMs?: number; timeoutMs?: number; maxQueueWaitMs?: number }
): Promise<FindingsJobProgress> {
  const intervalMs = options?.intervalMs ?? 2_000;
  const timeoutMs = options?.timeoutMs ?? 30 * 60_000;
  const maxQueueWaitMs = options?.maxQueueWaitMs ?? FINDINGS_MAX_QUEUE_WAIT_MS;
  let deadline = Date.now() + timeoutMs;
  let firstSeenQueuedAt: number | null = null;

  while (Date.now() < deadline) {
    let res: Response;
    try {
      res = await fetch(statusUrl, { credentials: "same-origin" });
    } catch (err) {
      throw normalizeFindingsClientError(err, { statusUrl });
    }

    const json = (await res.json()) as {
      ok?: boolean;
      job?: FindingsJobProgress & { id?: string };
      code?: string;
      message?: string;
      requestId?: string;
    };

    if (!res.ok || !json.ok || !json.job) {
      throw analysisError({
        code: (json.code as AnalysisErrorContract["code"]) || "INTERNAL_ERROR",
        message: json.message || `Status poll failed (${res.status}).`,
        retryable: res.status >= 500,
        requestId: json.requestId || createRequestId(),
        statusUrl,
        requiredAction: "RETRY",
      });
    }

    const progress: FindingsJobProgress = {
      jobId: json.job.id || json.job.jobId || "",
      status: json.job.status,
      stage: json.job.stage,
      claimedBy: json.job.claimedBy,
      workerHost: json.job.workerHost,
      workerIdentity: (json.job as FindingsJobProgress).workerIdentity,
      findingsId: json.job.findingsId,
      graphId: json.job.graphId,
      failureCode: json.job.failureCode,
      failureMessage: json.job.failureMessage,
      statusHistory: json.job.statusHistory,
      createdAt: json.job.createdAt,
      updatedAt: json.job.updatedAt,
      completedAt: json.job.completedAt,
      sourceCommit: json.job.sourceCommit,
      workflowRunId: (json.job as { workflowRunId?: string }).workflowRunId,
      workflowRunUrl: (json.job as { workflowRunUrl?: string }).workflowRunUrl,
      workerMode: (json.job as { workerMode?: string }).workerMode,
      heartbeatAt: (json.job as { heartbeatAt?: string }).heartbeatAt,
      stageStartedAt: (json.job as FindingsJobProgress).stageStartedAt,
      lastActivityAt: (json.job as FindingsJobProgress).lastActivityAt,
      progressMessage: (json.job as FindingsJobProgress).progressMessage,
      completedUnits: (json.job as FindingsJobProgress).completedUnits,
      totalUnits: (json.job as FindingsJobProgress).totalUnits,
      timingBreakdown: (json.job as FindingsJobProgress).timingBreakdown,
      progress: (json.job as FindingsJobProgress).progress,
      leaseExpiresAt: (json.job as FindingsJobProgress).leaseExpiresAt,
      repositoryOwner: (json.job as FindingsJobProgress).repositoryOwner,
      repositoryName: (json.job as FindingsJobProgress).repositoryName,
    };
    onProgress(progress);

    const stage = String(progress.stage);
    if (
      stage === "QUEUED" ||
      stage === "DISPATCHING" ||
      stage === "DISPATCHED" ||
      stage === "WAITING_FOR_RUNNER" ||
      progress.status === "queued"
    ) {
      if (firstSeenQueuedAt == null) firstSeenQueuedAt = Date.now();
      if (Date.now() - firstSeenQueuedAt >= maxQueueWaitMs) {
        throw analysisError({
          code: "QUEUE_WAIT_EXCEEDED",
          message:
            "No GitHub Actions runner claimed this job within the queue-wait budget. The durable job remains queued — resume later or cancel.",
          retryable: true,
          requestId: createRequestId(),
          jobId: progress.jobId,
          statusUrl,
          requiredAction: "RESUME_LATER_OR_CANCEL",
        });
      }
    } else {
      firstSeenQueuedAt = null;
    }

    if (progress.stage === "READY" || progress.stage === "COMPLETED" || progress.status === "complete") {
      return progress;
    }
    if (
      progress.stage === "WORKER_STALLED" ||
      progress.failureCode === "WORKER_STALLED"
    ) {
      throw analysisError({
        code: "WORKER_STALLED",
        message:
          progress.failureMessage ||
          "Authenticated worker activity became stale beyond the lease. Retry the analysis.",
        retryable: true,
        requestId: createRequestId(),
        jobId: progress.jobId,
        statusUrl,
        requiredAction: "RETRY",
      });
    }
    if (
      progress.stage === "FAILED" ||
      progress.stage === "FAILED_TERMINAL" ||
      progress.stage === "CANCELLED" ||
      progress.status === "failed"
    ) {
      throw analysisError({
        code:
          progress.stage === "CANCELLED"
            ? "CANCELLED"
            : ((progress.failureCode as AnalysisErrorContract["code"]) || "ANALYZER_FAILED"),
        message: progress.failureMessage || "Findings analysis failed.",
        retryable: progress.stage === "FAILED_RETRYABLE" || progress.stage === "WORKER_STALLED",
        requestId: createRequestId(),
        jobId: progress.jobId,
        statusUrl,
        requiredAction: progress.stage === "CANCELLED" ? "START_NEW_ANALYSIS" : "RETRY",
      });
    }

    // Fresh authenticated activity — do not show timed out; slide the deadline forward.
    const activityAt = progress.lastActivityAt || progress.heartbeatAt || progress.updatedAt;
    const activityFresh =
      activityAt && Date.now() - Date.parse(activityAt) < 5 * 60_000;
    if (activityFresh) {
      deadline = Math.max(deadline, Date.now() + timeoutMs);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw analysisError({
    code: "WORKER_LOST",
    message:
      "Timed out waiting for findings analysis. The durable job may still complete — refresh to resume.",
    retryable: true,
    requestId: createRequestId(),
    statusUrl,
    requiredAction: "REFRESH_OR_RETRY",
  });
}

/**
 * Durable Run Findings: enqueue (202) → poll deep-scan → load persisted findings.
 * Never waits for analyzers inside a single browser request.
 */
export async function runFindingsAnalysis(
  repoUrl: string,
  branch: string | undefined,
  onPhase: (phase: FindingsPhase) => void,
  scanId?: string,
  projectRoot?: string,
  options?: {
    sourceCommit?: string;
    onAccepted?: (accepted: FindingsJobAccepted) => void;
    onProgress?: (progress: FindingsJobProgress) => void;
  }
): Promise<FindingsPayload> {
  if (!scanId?.trim()) {
    throw analysisError({
      code: "SCAN_NOT_FOUND",
      message: "Structure scan ID is required before Run Findings.",
      retryable: false,
      requestId: createRequestId(),
      requiredAction: "RUN_STRUCTURE_SCAN",
    });
  }

  onPhase("queued");

  const existing = loadPersistedAnalysisJob(scanId.trim());
  let accepted: FindingsJobAccepted;

  if (existing) {
    accepted = {
      accepted: true,
      jobId: existing.jobId,
      taskId: existing.jobId,
      status: "QUEUED",
      stage: "QUEUED",
      statusUrl: existing.statusUrl,
      workerReady: false,
      requestId: existing.requestId,
      structureScanId: existing.structureScanId,
      message: "Resuming durable findings job from this browser session.",
    };
  } else {
    accepted = await startDurableFindingsAnalysis({
      structureScanId: scanId.trim(),
      repoUrl,
      branch,
      sourceCommit: options?.sourceCommit,
      projectRoot,
    });
  }

  options?.onAccepted?.(accepted);
  onPhase(mapDeepScanStageToPhase(accepted.stage));

  const completed = await pollDurableFindingsJob(accepted.statusUrl, (progress) => {
    onPhase(mapDeepScanStageToPhase(String(progress.stage)));
    options?.onProgress?.(progress);
  });

  const findingsId = completed.findingsId || scanId.trim();
  const findings = await fetchPersistedFindings(findingsId);
  onPhase("ready");
  clearPersistedAnalysisJob();
  return findings;
}

export function flattenFindings(payload: FindingsPayload) {
  return [
    ...payload.duplicates,
    ...payload.unused.files,
    ...payload.unused.dependencies,
    ...payload.unused.exports,
    ...payload.orphans,
    ...payload.slopSignals,
  ];
}

export const CLEANUP_PROMPT_PREFIX =
  "Review these RepoDiet findings and propose a conservative cleanup plan. Do not delete framework routes, config files, env files, lockfiles, or public assets without confirmation.";

export function buildCleanupPrompt(payload: FindingsPayload): string {
  const s = payload.summary;
  const safeLine =
    s.safeCandidates === 0
      ? "Safe candidates are 0, so do not generate delete operations yet. Only propose a review plan and group findings by safest-first cleanup order."
      : "Start with safe candidates only, then review remaining items separately.";

  const knipLabel = analyzerStageLabel(payload.rawToolReports.knip);
  const jscpdLabel = analyzerStageLabel(payload.rawToolReports.jscpd);
  const madgeLabel = analyzerStageLabel(payload.rawToolReports.madge);

  return `${CLEANUP_PROMPT_PREFIX}
${safeLine}

Repository: ${payload.repo.owner}/${payload.repo.name} (${payload.repo.branch})
Scan ID: ${payload.scanId}
Mode: ${payload.mode}

Summary:
- Duplicate clusters: ${s.duplicateClusters}
- Unused files: ${s.unusedFiles}
- Unused dependencies: ${s.unusedDependencies}
- Unused exports: ${s.unusedExports}
- Orphan patterns: ${s.orphanPatterns}
- AI-slop signals: ${s.slopSignals}
- Raw review findings: ${s.reviewRequired}
- Candidates for developer review: ${s.safeCandidates}

Analyzers: ${jscpdLabel} (${payload.rawToolReports.jscpd.durationMs}ms), ${knipLabel} (${payload.rawToolReports.knip.durationMs}ms), ${madgeLabel} (${payload.rawToolReports.madge.durationMs}ms)`;
}
