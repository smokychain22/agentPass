export const DEEP_SCAN_STAGES = [
  "QUEUED",
  "DISPATCHING",
  "DISPATCHED",
  "WAITING_FOR_RUNNER",
  "CLAIMED",
  "PREPARING_ARCHIVE",
  "DOWNLOADING_ARCHIVE",
  "ARCHIVE_READY",
  "INVENTORY",
  "RESOLVING_PROJECTS",
  "BUILDING_GRAPH",
  "RUNNING_ANALYZERS",
  "RUNNING_JSCpd",
  "RUNNING_KNIP",
  "RUNNING_MADGE",
  "RUNNING_INTERNAL_HEURISTICS",
  "NORMALIZING_FINDINGS",
  "VALIDATING_EVIDENCE",
  "PERSISTING_RESULTS",
  "BASELINE_VERIFICATION",
  "AWAITING_SCOPE",
  "PATCHING",
  "VERIFYING",
  "CREATING_PR",
  "MONITORING_CHECKS",
  "SIGNING_PROOF",
  "DELIVERY_READY",
  "READY",
  "COMPLETED",
  "WORKER_STALLED",
  "FAILED",
  "FAILED_RETRYABLE",
  "FAILED_TERMINAL",
  "CANCELLED",
] as const;

export type DeepScanStage = (typeof DEEP_SCAN_STAGES)[number];

export interface DeepScanJobRequest {
  repoUrl: string;
  branch?: string;
  projectRoot?: string;
  sourceCommit?: string;
  a2aTaskId?: string;
  requestedBy?: string;
  /** When true, skip baseline install/typecheck/build (read-only audit). */
  readOnly?: boolean;
  /** Multi-tenant binding — required for marketplace isolation. */
  tenantId?: string;
  buyerWallet?: string;
  okxBuyerId?: string;
  githubInstallationId?: string;
  /** Structure scan this findings job continues from. */
  structureScanId?: string;
}

export interface DeepScanProgress {
  stage: DeepScanStage;
  percent: number;
  detail?: string;
  updatedAt: string;
  stageStartedAt?: string;
  lastActivityAt?: string;
  completedUnits?: number;
  totalUnits?: number;
  message?: string;
}

export interface DeepScanJob {
  id: string;
  status: "queued" | "running" | "complete" | "failed";
  stage: DeepScanStage;
  progress: DeepScanProgress;
  request: DeepScanJobRequest;
  tenantId?: string;
  /** Canonical server-owned repository identity — required before claim. */
  repositoryTarget?: import("@/lib/repository/repository-target").RepositoryTarget;
  repositoryTargetId?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  repositoryFullName?: string;
  repositoryUrl?: string;
  branch?: string;
  sourceCommit?: string;
  projectRoot?: string;
  scanId?: string;
  findingsId?: string;
  graphId?: string;
  coverage?: Record<string, unknown>;
  baseline?: Record<string, unknown>;
  resultSummary?: Record<string, unknown>;
  failureCode?: string;
  failureMessage?: string;
  claimedBy?: string;
  /** Server-side only — never returned to Actions complete/analyze or artifacts. */
  claimToken?: string;
  /** Opaque non-secret handle returned to claim job for correlation only (not authorizing). */
  claimHandle?: string;
  /**
   * SHA-256 of progress-only token minted at claim.
   * Analyze may use the raw progressToken (not Worker API key / callback secret).
   */
  progressTokenHash?: string;
  claimedAt?: string;
  heartbeatAt?: string;
  leaseExpiresAt?: string;
  workerHost?: string;
  /** Authenticated worker identity last seen on a progress callback. */
  workerIdentity?: string;
  stageStartedAt?: string;
  lastActivityAt?: string;
  progressMessage?: string;
  completedUnits?: number;
  totalUnits?: number;
  timingBreakdown?: import("@/lib/deep-scan/timing-breakdown").TimingBreakdown;
  /** GitHub Actions on-demand worker fields */
  workerMode?: "github_actions_on_demand" | "always_on" | "unset";
  dispatchNonce?: string;
  dispatchNonceUsedAt?: string;
  workflowRunId?: string;
  workflowRunAttempt?: string;
  workflowName?: string;
  workflowRepository?: string;
  workflowRunUrl?: string;
  dispatchedAt?: string;
  analysisConfigDigest?: string;
  /** One-use completion nonce digest tracking (optional). */
  lastCompletionNonce?: string;
  attemptCount: number;
  statusHistory: Array<{ stage: DeepScanStage; at: string; detail?: string }>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export const DEEP_SCAN_LEASE_MS = 120_000;
export const DEEP_SCAN_MAX_ATTEMPTS = 3;

export function stagePercent(stage: DeepScanStage): number {
  if (stage === "READY" || stage === "COMPLETED" || stage === "DELIVERY_READY") return 100;
  const order: DeepScanStage[] = [
    "QUEUED",
    "DISPATCHING",
    "DISPATCHED",
    "WAITING_FOR_RUNNER",
    "CLAIMED",
    "PREPARING_ARCHIVE",
    "DOWNLOADING_ARCHIVE",
    "ARCHIVE_READY",
    "INVENTORY",
    "RESOLVING_PROJECTS",
    "BUILDING_GRAPH",
    "RUNNING_JSCpd",
    "RUNNING_KNIP",
    "RUNNING_MADGE",
    "RUNNING_INTERNAL_HEURISTICS",
    "RUNNING_ANALYZERS",
    "NORMALIZING_FINDINGS",
    "VALIDATING_EVIDENCE",
    "PERSISTING_RESULTS",
    "BASELINE_VERIFICATION",
    "AWAITING_SCOPE",
  ];
  if (
    stage === "FAILED" ||
    stage === "FAILED_RETRYABLE" ||
    stage === "FAILED_TERMINAL" ||
    stage === "CANCELLED" ||
    stage === "WORKER_STALLED"
  ) {
    return 100;
  }
  const idx = order.indexOf(stage);
  if (idx < 0) {
    // Cleanup/delivery stages after scan READY
    const delivery: DeepScanStage[] = [
      "PATCHING",
      "VERIFYING",
      "CREATING_PR",
      "MONITORING_CHECKS",
      "SIGNING_PROOF",
    ];
    const dIdx = delivery.indexOf(stage);
    if (dIdx >= 0) return 90 + Math.round((dIdx / Math.max(1, delivery.length - 1)) * 9);
    return 0;
  }
  return Math.round((idx / Math.max(1, order.length - 1)) * 90);
}
