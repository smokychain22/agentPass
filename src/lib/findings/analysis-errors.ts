import { nanoid } from "nanoid";
import type { CustomerErrorCode, CustomerErrorResponse } from "@/lib/product/customer-errors";
import { customerError } from "@/lib/product/customer-errors";

export type AnalysisErrorCode =
  | CustomerErrorCode
  | "WORKER_LOST"
  | "SCAN_NOT_FOUND"
  | "SOURCE_COMMIT_MISMATCH"
  | "REPOSITORY_ARCHIVE_FAILED"
  | "REPOSITORY_TOO_LARGE"
  | "ANALYZER_FAILED"
  | "GRAPH_FAILED"
  | "PERSISTENCE_FAILED"
  | "LEASE_EXPIRED"
  | "INTERNAL_ERROR"
  | "SCAN_REPOSITORY_MISMATCH";

export interface AnalysisErrorContract extends Omit<CustomerErrorResponse, "code"> {
  code: AnalysisErrorCode;
  structureScanId?: string;
  jobId?: string;
  taskId?: string;
  requestId: string;
  statusUrl?: string;
}

export function createRequestId(): string {
  return `req_${nanoid(12)}`;
}

export function analysisError(input: {
  code: AnalysisErrorCode;
  message: string;
  retryable: boolean;
  requestId: string;
  requiredAction: string;
  paymentState?: CustomerErrorResponse["paymentState"];
  structureScanId?: string;
  jobId?: string;
  taskId?: string;
  statusUrl?: string;
}): AnalysisErrorContract {
  const base = customerError({
    code: (input.code in {
      WORKER_UNAVAILABLE: 1,
      CAPACITY_LIMIT: 1,
      TENANT_FORBIDDEN: 1,
      TASK_NOT_FOUND: 1,
      INVALID_INPUT: 1,
      UNSUPPORTED_REPOSITORY: 1,
      REPO_TOO_LARGE: 1,
      PRIVATE_UNAUTHORIZED: 1,
    }
      ? input.code
      : "INVALID_INPUT") as CustomerErrorCode,
    message: input.message,
    retryable: input.retryable,
    paymentState: input.paymentState,
    taskId: input.taskId ?? input.jobId,
    statusUrl: input.statusUrl,
    requiredAction: input.requiredAction,
  });
  return {
    ...base,
    code: input.code,
    structureScanId: input.structureScanId,
    jobId: input.jobId,
    taskId: input.taskId,
    requestId: input.requestId,
    statusUrl: input.statusUrl,
  };
}

/** Map low-level fetch failures to a user-visible analysis error. */
export function normalizeFindingsClientError(
  err: unknown,
  context: { structureScanId?: string; jobId?: string; requestId?: string; statusUrl?: string }
): AnalysisErrorContract {
  const requestId = context.requestId ?? createRequestId();
  const message = err instanceof Error ? err.message : String(err ?? "Unknown error");
  const lower = message.toLowerCase();

  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("load failed") ||
    lower.includes("the operation was aborted")
  ) {
    return analysisError({
      code: "INTERNAL_ERROR",
      message:
        "The browser lost the connection before RepoDiet returned a status. Findings now use a durable job — refresh to resume, or start analysis again.",
      retryable: true,
      requestId,
      structureScanId: context.structureScanId,
      jobId: context.jobId,
      statusUrl: context.statusUrl,
      requiredAction: "REFRESH_OR_RETRY",
    });
  }

  return analysisError({
    code: "INTERNAL_ERROR",
    message,
    retryable: true,
    requestId,
    structureScanId: context.structureScanId,
    jobId: context.jobId,
    statusUrl: context.statusUrl,
    requiredAction: "RETRY",
  });
}
