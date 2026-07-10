import type { TaskOperation } from "@/lib/execution/task-quote";

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

export type QuoteStatus = "active" | "payment_required" | "funded" | "consumed" | "expired" | "refunded";

export interface BoundQuote {
  quoteId: string;
  operation: TaskOperation;
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
  paymentReference?: string;
  payer?: string;
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
  operation: TaskOperation;
  quoteId: string;
  taskId?: string;
}
