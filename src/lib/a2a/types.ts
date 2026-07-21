import type { MaintenanceOutcome } from "@/lib/maintenance/outcome";

export type A2ATaskType =
  | "repository.analysis"
  | "repository.safe_cleanup"
  | "repository.verified_cleanup"
  | "repository.cleanup_pr"
  | "repository.guard_activation";

export type PurchaseChannel = "okx_marketplace" | "direct_site";

export type A2ATaskStatus =
  | "submitted"
  | "validating"
  | "quote_required"
  | "awaiting_payment"
  | "funded"
  | "queued"
  | "fetching_repository"
  | "analyzing"
  | "awaiting_approval"
  | "generating_changes"
  | "validating_patch"
  | "verifying"
  | "creating_pull_request"
  | "monitoring_checks"
  | "checks_failed"
  | "diagnosis_ready"
  | "owner_action_required"
  | "delivery_ready"
  /** Seller submitted delivery evidence for buyer inspection. */
  | "delivery_submitted"
  /** Buyer inspected and accepted the delivered Green PR. */
  | "buyer_accepted"
  /** Escrow release to seller recorded (OKX-native release reference). */
  | "escrow_released"
  | "completed"
  | "rejected"
  | "disputed"
  | "unsupported"
  | "payment_failed"
  | "analysis_failed"
  | "verification_failed"
  | "delivery_failed"
  | "cancelled"
  | "expired";

export const A2A_FAILURE_STATUSES: A2ATaskStatus[] = [
  "rejected",
  "disputed",
  "unsupported",
  "payment_failed",
  "analysis_failed",
  "verification_failed",
  "delivery_failed",
  "checks_failed",
  "owner_action_required",
  "cancelled",
  "expired",
];

export const A2A_TERMINAL_STATUSES: A2ATaskStatus[] = [
  "completed",
  "escrow_released",
  ...A2A_FAILURE_STATUSES,
];

/** Lifecycle stages after a real Green PR is ready for buyer settlement. */
export const A2A_SETTLEMENT_STATUSES: A2ATaskStatus[] = [
  "delivery_ready",
  "delivery_submitted",
  "buyer_accepted",
  "escrow_released",
  "completed",
];

export type InternalRole =
  | "orchestrator"
  | "repository_analyzer"
  | "safety_classifier"
  | "fix_executor"
  | "verification_worker"
  | "github_delivery_worker"
  | "ci_monitor"
  | "receipt_signer";

export interface A2AApprovalCheckpoint {
  summary: string;
  repository: string;
  branch: string;
  changes: Array<{ path: string; action: "delete" | "modify"; summary?: string }>;
  unifiedDiff?: string;
  expiresAt: string;
}

export interface A2ATaskTransition {
  status: A2ATaskStatus;
  at: string;
  role: InternalRole;
  detail?: string;
}

export interface A2ATaskRepository {
  owner: string;
  name: string;
  branch: string;
  commitSha?: string;
  url?: string;
}

export interface A2ATaskInput {
  repoUrl: string;
  branch?: string;
  scanId?: string;
  commitSha?: string;
  findingIds?: string[];
  quoteId?: string;
  paymentReference?: string;
  payer?: string;
  callbackUrl?: string;
  githubToken?: string;
  demo?: boolean;
  transformedSourceHashes?: Record<string, string>;
  contractId?: string;
  contractDigest?: string;
  /** Commercial route chosen before the task is created. */
  purchaseChannel?: PurchaseChannel;
  /** SHA-256 of the originating browser session for direct-site task ownership. */
  ownerSessionKeyHash?: string;
}

export interface A2ATaskResult {
  /** Concrete repository outcome derived from delivered patch operations, never a score. */
  maintenanceOutcome?: MaintenanceOutcome;
  /** Durable deep-scan job for full repository analysis (not Quick Triage). */
  deepScanJobId?: string;
  /** Same as deepScanJobId — explicit queue identity for dispatch correlation. */
  queueJobId?: string;
  deepScanProgressUrl?: string;
  dispatchState?: string;
  dispatchAttempt?: number;
  workflowRunId?: string;
  workflowRunUrl?: string;
  /** Optimistic concurrency version for parent↔child reconciliation. */
  stateVersion?: number;
  reconciledFromScanAt?: string;
  childScanStage?: string;
  recoverable?: boolean;
  findings?: Record<string, unknown>;
  changes?: {
    changedFiles: string[];
    unifiedDiff?: string;
    finalDecision?: string;
    patchId?: string;
    patchKitId?: string;
  };
  verification?: {
    status: string;
    checks?: unknown[];
    limitations?: string[];
    baseline?: unknown;
    patched?: unknown;
  };
  pullRequest?: {
    url?: string;
    number?: number;
    title?: string;
    branch?: string;
  };
  receipt?: Record<string, unknown>;
  guard?: Record<string, unknown>;
  baselineRun?: Record<string, unknown>;
  prDelivery?: Record<string, unknown>;
  maintenanceContract?: {
    contractId: string;
    contractDigest: string;
    status: string;
  };
  greenPrExecution?: Record<string, unknown>;
  attestation?: Record<string, unknown>;
  /** A2A settlement evidence (escrow → delivery → buyer accept → release). */
  settlement?: {
    escrowReference?: string;
    deliveryId?: string;
    deliverySubmittedAt?: string;
    buyerAcceptedAt?: string;
    buyerWallet?: string;
    escrowReleasedAt?: string;
    escrowReleaseReference?: string;
    sellerWallet?: string;
    disputeOpenedAt?: string;
    disputeReason?: string;
  };
}

export interface A2ATaskWorkflowMeta {
  status: "invalid_source_baseline" | "stale_source_commit";
  retryable: false;
  requiresNewScan: true;
  reason: string;
  pinnedCommitSha?: string;
  currentCommitSha?: string;
  failedCheck?: string;
  classification?: string;
  invalidatedAt: string;
}

export interface A2ATaskRecord {
  id: string;
  type: A2ATaskType;
  status: A2ATaskStatus;
  repository: A2ATaskRepository;
  scanId?: string;
  input: A2ATaskInput;
  approval?: A2AApprovalCheckpoint;
  quoteId?: string;
  result: A2ATaskResult;
  transitions: A2ATaskTransition[];
  limitations: string[];
  workflowMeta?: A2ATaskWorkflowMeta;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export function mapTaskTypeToOperation(
  type: A2ATaskType
): "free_proof" | "quick_cleanup" | "verified_cleanup_pr" | "repo_guard" | null {
  switch (type) {
    case "repository.analysis":
      return null;
    case "repository.safe_cleanup":
      // Intentional pre-contract analysis phase — preserve requestedTaskType separately.
      return "free_proof";
    case "repository.verified_cleanup":
      return "verified_cleanup_pr";
    case "repository.cleanup_pr":
      return "verified_cleanup_pr";
    case "repository.guard_activation":
      return "repo_guard";
    default:
      return null;
  }
}

export function requiresPayment(type: A2ATaskType): boolean {
  return (
    type === "repository.verified_cleanup" ||
    type === "repository.cleanup_pr" ||
    type === "repository.guard_activation"
  );
}

export function requiresApproval(type: A2ATaskType): boolean {
  return type === "repository.cleanup_pr";
}
