import type { CommerceOperation } from "@/lib/payment/types";

export type OkxServiceType = "A2MCP" | "A2A";

export type A2mcpServiceId =
  | "scan_repository"
  | "analyze_repository"
  | "list_safe_fixes"
  | "verify_patch"
  | "repository_health_delta";

export type A2aServiceId =
  | "verified_cleanup_pr"
  | "deep_cleanup_review"
  | "repo_guard_mission";

export type OkxServiceId = A2mcpServiceId | A2aServiceId;

export interface OkxServiceDefinition {
  serviceId: OkxServiceId;
  serviceType: OkxServiceType;
  operation: CommerceOperation;
  label: string;
  description: string;
  amountMicro: string;
  priceLabel: string;
  /** Read-only public repo operations — no GitHub write */
  readOnly: boolean;
  requiresEscrow: boolean;
  requiresApproval: boolean;
}

export interface PaymentRequirementInput {
  serviceId: OkxServiceId;
  repository: string;
  branch: string;
  commitSha: string;
  requestHash: string;
  resourceUrl: string;
  findingIds?: string[];
  idempotencyKey?: string;
}

export interface PaymentRequirement {
  quoteId: string;
  serviceId: OkxServiceId;
  amount: string;
  amountMicro: string;
  currency: "USDT";
  network: string;
  recipient: string;
  nonce: string;
  expiresAt: string;
  requestHash: string;
  x402Body: Record<string, unknown>;
}

export interface PaymentVerificationInput {
  quoteId: string;
  paymentReference: string;
  payer: string;
  amountMicro: string;
  nonce: string;
  idempotencyKey: string;
  paymentSignature?: string;
}

export interface VerifiedPayment {
  ok: boolean;
  quoteId: string;
  status: string;
  reason?: string;
  existingTaskId?: string;
}

export interface PaymentSettlementInput {
  quoteId: string;
  taskId: string;
}

export interface SettlementResult {
  ok: boolean;
  quoteId: string;
  taskId: string;
  status: string;
}

export interface PaymentReceipt {
  receiptId: string;
  serviceId: OkxServiceId;
  serviceType: OkxServiceType;
  taskId: string;
  requestHash: string;
  resultHash: string;
  signature?: string;
  /** Canonical signed payload for independent cryptographic verification. */
  signedReceipt?: Record<string, unknown>;
  operatorAgentId: string;
  timestamp: string;
  quoteId?: string;
  paymentReference?: string;
  buyer?: string;
  seller?: string;
  amountMicro?: string;
  token?: string;
  network?: string;
  operation?: string;
  repository?: string;
  resultDigest?: string;
  completedAt?: string;
}

export interface CommerceBinding {
  repository: string;
  branch: string;
  commitSha: string;
  findingIds: string[];
  operation: CommerceOperation;
  requestHash: string;
}

export interface OkxOrderRecord {
  orderId: string;
  serviceId: A2aServiceId;
  serviceType: "A2A";
  repository: string;
  branch: string;
  commitSha: string;
  status: string;
  escrowReference?: string;
  taskId?: string;
  a2aTaskId?: string;
  quoteId?: string;
  payer?: string;
  amountMicro?: string;
  contractId?: string;
  contractDigest?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceDeliveryRecord {
  deliveryId: string;
  orderId: string;
  taskId: string;
  serviceId: OkxServiceId;
  deliveryVersion: number;
  payload: Record<string, unknown>;
  receiptId?: string;
  createdAt: string;
}

/** Adapter contract — connect real OKX Payment SDK when available from Onchain OS. */
export interface OkxPaymentProvider {
  createRequirement(input: PaymentRequirementInput): Promise<PaymentRequirement>;
  verifyPayment(input: PaymentVerificationInput): Promise<VerifiedPayment>;
  settlePayment(input: PaymentSettlementInput): Promise<SettlementResult>;
  getReceipt(paymentId: string): Promise<PaymentReceipt | undefined>;
}
