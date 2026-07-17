export const DEEP_SCAN_STAGES = [
  "QUEUED",
  "CLAIMED",
  "INVENTORY",
  "RESOLVING_PROJECTS",
  "BUILDING_GRAPH",
  "RUNNING_ANALYZERS",
  "NORMALIZING_FINDINGS",
  "VALIDATING_EVIDENCE",
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
}

export interface DeepScanProgress {
  stage: DeepScanStage;
  percent: number;
  detail?: string;
  updatedAt: string;
}

export interface DeepScanJob {
  id: string;
  status: "queued" | "running" | "complete" | "failed";
  stage: DeepScanStage;
  progress: DeepScanProgress;
  request: DeepScanJobRequest;
  tenantId?: string;
  repositoryOwner?: string;
  repositoryName?: string;
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
  claimToken?: string;
  claimedAt?: string;
  heartbeatAt?: string;
  leaseExpiresAt?: string;
  workerHost?: string;
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
    "CLAIMED",
    "INVENTORY",
    "RESOLVING_PROJECTS",
    "BUILDING_GRAPH",
    "RUNNING_ANALYZERS",
    "NORMALIZING_FINDINGS",
    "VALIDATING_EVIDENCE",
    "BASELINE_VERIFICATION",
    "AWAITING_SCOPE",
  ];
  if (
    stage === "FAILED" ||
    stage === "FAILED_RETRYABLE" ||
    stage === "FAILED_TERMINAL" ||
    stage === "CANCELLED"
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
