/**
 * Public marketplace capacity limits — honest, not silent truncation.
 */

export interface PublicCapacityLimits {
  maxArchiveBytes: number;
  maxFilesPerScan: number;
  maxSingleSourceFileBytes: number;
  maxProjectRoots: number;
  maxDeepScanDurationMs: number;
  maxCleanupFilesChanged: number;
  maxCleanupLinesChanged: number;
  maxConcurrentDeepScansPerTenant: number;
  maxConcurrentDeepScansGlobal: number;
  maxConcurrentCleanupsPerTenant: number;
  a2aInitialResponseBudgetMs: number;
  a2mcpQuickTriageBudgetMs: number;
}

export const PUBLIC_CAPACITY_LIMITS: PublicCapacityLimits = {
  maxArchiveBytes: 100 * 1024 * 1024,
  maxFilesPerScan: 20_000,
  maxSingleSourceFileBytes: 2 * 1024 * 1024,
  maxProjectRoots: 40,
  maxDeepScanDurationMs: 30 * 60 * 1000,
  maxCleanupFilesChanged: 40,
  maxCleanupLinesChanged: 2_000,
  maxConcurrentDeepScansPerTenant: 2,
  maxConcurrentDeepScansGlobal: 8,
  maxConcurrentCleanupsPerTenant: 1,
  a2aInitialResponseBudgetMs: 10_000,
  a2mcpQuickTriageBudgetMs: 20_000,
};

export interface CapacityLimitResponse {
  status: "CAPACITY_LIMIT" | "REPO_TOO_LARGE";
  code: string;
  message: string;
  limit: number;
  actual: number;
  retryable: boolean;
  requiredAction: "REDUCE_SCOPE" | "SPLIT_BY_PROJECT_ROOT" | "RETRY_LATER";
  paymentRequired: false;
}

export function capacityLimitResponse(input: {
  code: string;
  message: string;
  limit: number;
  actual: number;
  requiredAction?: CapacityLimitResponse["requiredAction"];
  retryable?: boolean;
}): CapacityLimitResponse {
  return {
    status: input.code.includes("QUEUE") ? "CAPACITY_LIMIT" : "REPO_TOO_LARGE",
    code: input.code,
    message: input.message,
    limit: input.limit,
    actual: input.actual,
    retryable: input.retryable ?? false,
    requiredAction: input.requiredAction ?? "REDUCE_SCOPE",
    paymentRequired: false,
  };
}
