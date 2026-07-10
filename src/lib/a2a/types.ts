export type A2ATaskType =
  | "repository.analysis"
  | "repository.safe_cleanup"
  | "repository.verified_cleanup"
  | "repository.cleanup_pr"
  | "repository.guard_activation";

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
  | "completed"
  | "rejected"
  | "unsupported"
  | "payment_failed"
  | "analysis_failed"
  | "verification_failed"
  | "delivery_failed"
  | "cancelled"
  | "expired";

export const A2A_FAILURE_STATUSES: A2ATaskStatus[] = [
  "rejected",
  "unsupported",
  "payment_failed",
  "analysis_failed",
  "verification_failed",
  "delivery_failed",
  "cancelled",
  "expired",
];

export const A2A_TERMINAL_STATUSES: A2ATaskStatus[] = [
  "completed",
  ...A2A_FAILURE_STATUSES,
];

export type InternalRole =
  | "orchestrator"
  | "repository_analyzer"
  | "safety_classifier"
  | "fix_executor"
  | "verification_worker"
  | "github_delivery_worker"
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
  findingIds?: string[];
  quoteId?: string;
  paymentReference?: string;
  callbackUrl?: string;
  githubToken?: string;
  demo?: boolean;
}

export interface A2ATaskResult {
  findings?: Record<string, unknown>;
  changes?: {
    changedFiles: string[];
    unifiedDiff?: string;
    finalDecision?: string;
    patchId?: string;
  };
  verification?: {
    status: string;
    checks?: unknown[];
    limitations?: string[];
  };
  pullRequest?: {
    url?: string;
    number?: number;
    title?: string;
    branch?: string;
  };
  receipt?: Record<string, unknown>;
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
      return "free_proof";
    case "repository.verified_cleanup":
      return "quick_cleanup";
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
