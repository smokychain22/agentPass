/**
 * Customer-visible failure contract for marketplace responses.
 */

export type CustomerErrorCode =
  | "UNSUPPORTED_REPOSITORY"
  | "REPO_TOO_LARGE"
  | "PRIVATE_UNAUTHORIZED"
  | "GITHUB_APP_MISSING"
  | "BRANCH_MISSING"
  | "SOURCE_CHANGED"
  | "NO_SAFE_FINDINGS"
  | "BASELINE_FAILED"
  | "WORKER_UNAVAILABLE"
  | "QUEUE_FULL"
  | "PAYMENT_FAILED"
  | "ESCROW_MISSING"
  | "VERIFICATION_FAILED"
  | "GITHUB_PERMISSION_REVOKED"
  | "PR_CREATION_FAILED"
  | "INVALID_INPUT"
  | "TENANT_FORBIDDEN"
  | "CAPACITY_LIMIT"
  | "TASK_NOT_FOUND";

export type PaymentState =
  | "not_required"
  | "required"
  | "pending"
  | "settled"
  | "failed"
  | "unknown";

export interface CustomerErrorResponse {
  code: CustomerErrorCode;
  message: string;
  retryable: boolean;
  paymentState: PaymentState;
  taskId?: string;
  statusUrl?: string;
  requiredAction: string;
}

export function customerError(input: {
  code: CustomerErrorCode;
  message: string;
  retryable: boolean;
  paymentState?: PaymentState;
  taskId?: string;
  statusUrl?: string;
  requiredAction: string;
}): CustomerErrorResponse {
  return {
    code: input.code,
    message: input.message,
    retryable: input.retryable,
    paymentState: input.paymentState ?? "not_required",
    taskId: input.taskId,
    statusUrl: input.statusUrl,
    requiredAction: input.requiredAction,
  };
}
