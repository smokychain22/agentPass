import type { TaskOperation } from "@/lib/execution/task-quote";

export type A2mcpOperation =
  | "scan_repository"
  | "analyze_repository"
  | "list_safe_fixes"
  | "verify_patch"
  | "repository_health_delta";

export type CommerceOperation = TaskOperation | A2mcpOperation;

export type VerificationProfile = "standard" | "strict";

export type PaymentLifecycleStatus =
  | "quote_created"
  | "payment_required"
  | "payment_submitted"
  | "payment_verifying"
  | "funded"
  | "execution_started"
  | "completed"
  | "expired"
  | "invalid_payment"
  | "wrong_amount"
  | "wrong_token"
  | "wrong_network"
  | "wrong_recipient"
  | "replayed"
  | "execution_failed"
  | "credited"
  | "refunded";

/** Durable paid-execution state — never treat CONSUMED as success by itself. */
export type QuoteExecutionState =
  | "FUNDED"
  | "EXECUTING"
  | "SUCCEEDED"
  | "FAILED_RETRYABLE"
  | "FAILED_FINAL";

export type PaymentStatus = "pending" | "verified" | "failed";

export type QuoteStatus = "active" | "payment_required" | "funded" | "consumed" | "expired" | "refunded";

export interface BoundQuote {
  quoteId: string;
  operation: CommerceOperation;
  repository: string;
  branch: string;
  commitSha: string;
  findingIds: string[];
  verificationProfile: VerificationProfile;
  amount: string;
  amountMicro: string;
  currency: "USDT";
  network: string;
  recipient: string;
  asset: string;
  nonce: string;
  expiresAt: string;
  requestHash: string;
  bindingHash: string;
  priceLabel: string;
  status: QuoteStatus;
  lifecycleStatus: PaymentLifecycleStatus;
  createdAt: string;
  idempotencyKey?: string;
  taskId?: string;
  a2aTaskId?: string;
  scanId?: string;
  transformedSourceHashes?: Record<string, string>;
  contractDigest?: string;
  paymentReference?: string;
  payer?: string;
  paymentStatus?: PaymentStatus;
  fundedAt?: string;
  verifiedAt?: string;
  /** Explicit execution state for A2MCP/A2A paid delivery. */
  executionState?: QuoteExecutionState;
  executionStartedAt?: string;
  executionCompletedAt?: string;
  lastFailureReason?: string;
  lastFailedTaskId?: string;
  completedTaskId?: string;
  completedReceiptId?: string;
}

export interface PaymentProof {
  quoteId: string;
  paymentReference: string;
  payer: string;
  amountMicro: string;
  currency: "USDT";
  network: string;
  recipient: string;
  nonce: string;
  idempotencyKey: string;
  paymentSignature?: string;
  taskId?: string;
}

export interface PaymentVerificationResult {
  ok: boolean;
  status: PaymentLifecycleStatus;
  reason?: string;
  quote?: BoundQuote;
  existingTaskId?: string;
}

export interface EntitlementContext {
  repository: string;
  branch: string;
  commitSha: string;
  findingIds: string[];
  operation: CommerceOperation;
  quoteId: string;
  taskId?: string;
  scanId?: string;
  transformedSourceHashes?: Record<string, string>;
  contractDigest?: string;
}
