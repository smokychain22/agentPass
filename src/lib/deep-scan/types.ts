export const DEEP_SCAN_STAGES = [
  "QUEUED",
  "INVENTORY",
  "RESOLVING_PROJECTS",
  "BUILDING_GRAPH",
  "RUNNING_ANALYZERS",
  "NORMALIZING_FINDINGS",
  "VALIDATING_EVIDENCE",
  "BASELINE_VERIFICATION",
  "READY",
  "FAILED",
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
  claimedAt?: string;
  heartbeatAt?: string;
  leaseExpiresAt?: string;
  attemptCount: number;
  statusHistory: Array<{ stage: DeepScanStage; at: string; detail?: string }>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export const DEEP_SCAN_LEASE_MS = 120_000;
export const DEEP_SCAN_MAX_ATTEMPTS = 3;

export function stagePercent(stage: DeepScanStage): number {
  const order: DeepScanStage[] = [
    "QUEUED",
    "INVENTORY",
    "RESOLVING_PROJECTS",
    "BUILDING_GRAPH",
    "RUNNING_ANALYZERS",
    "NORMALIZING_FINDINGS",
    "VALIDATING_EVIDENCE",
    "BASELINE_VERIFICATION",
    "READY",
  ];
  if (stage === "FAILED") return 100;
  const idx = order.indexOf(stage);
  if (idx < 0) return 0;
  return Math.round((idx / (order.length - 1)) * 100);
}
