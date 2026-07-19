import type { A2ATaskStatus } from "@/lib/a2a/types";

/**
 * Canonical OKX marketplace lifecycle for RepoDiet A2A tasks.
 * Maps onto internal A2ATaskStatus while exposing reviewer-facing states.
 */
export type OkxMarketplaceLifecycleState =
  | "RECEIVED"
  | "ACKNOWLEDGED"
  | "WAITING_FOR_REPOSITORY"
  | "ANALYZING"
  | "WAITING_FOR_DECISION"
  | "PLAN_READY"
  | "NEGOTIATING"
  | "ESCROW_PENDING"
  | "ESCROW_FUNDED"
  | "EXECUTING"
  | "VALIDATING"
  | "DELIVERED"
  | "ACCEPTED"
  | "REJECTED"
  | "FAILED_WITH_REASON";

export const OKX_MARKETPLACE_LIFECYCLE_STATES: OkxMarketplaceLifecycleState[] = [
  "RECEIVED",
  "ACKNOWLEDGED",
  "WAITING_FOR_REPOSITORY",
  "ANALYZING",
  "WAITING_FOR_DECISION",
  "PLAN_READY",
  "NEGOTIATING",
  "ESCROW_PENDING",
  "ESCROW_FUNDED",
  "EXECUTING",
  "VALIDATING",
  "DELIVERED",
  "ACCEPTED",
  "REJECTED",
  "FAILED_WITH_REASON",
];

const FROM_INTERNAL: Partial<Record<A2ATaskStatus, OkxMarketplaceLifecycleState>> = {
  submitted: "ACKNOWLEDGED",
  queued: "ACKNOWLEDGED",
  validating: "ANALYZING",
  fetching_repository: "WAITING_FOR_REPOSITORY",
  analyzing: "ANALYZING",
  awaiting_approval: "WAITING_FOR_DECISION",
  quote_required: "NEGOTIATING",
  awaiting_payment: "ESCROW_PENDING",
  funded: "ESCROW_FUNDED",
  generating_changes: "EXECUTING",
  validating_patch: "VALIDATING",
  verifying: "VALIDATING",
  creating_pull_request: "EXECUTING",
  monitoring_checks: "VALIDATING",
  delivery_ready: "DELIVERED",
  delivery_submitted: "DELIVERED",
  buyer_accepted: "ACCEPTED",
  escrow_released: "ACCEPTED",
  completed: "ACCEPTED",
  rejected: "REJECTED",
  cancelled: "REJECTED",
  disputed: "FAILED_WITH_REASON",
  unsupported: "FAILED_WITH_REASON",
  payment_failed: "FAILED_WITH_REASON",
  analysis_failed: "FAILED_WITH_REASON",
  verification_failed: "FAILED_WITH_REASON",
  delivery_failed: "FAILED_WITH_REASON",
  checks_failed: "FAILED_WITH_REASON",
  owner_action_required: "WAITING_FOR_DECISION",
  diagnosis_ready: "WAITING_FOR_DECISION",
  expired: "FAILED_WITH_REASON",
};

export function mapA2AStatusToMarketplaceLifecycle(
  status: A2ATaskStatus | string | undefined,
  opts?: { hasRepository?: boolean; discoveryOnly?: boolean }
): OkxMarketplaceLifecycleState {
  if (opts?.discoveryOnly) return "WAITING_FOR_REPOSITORY";
  if (!status) {
    return opts?.hasRepository === false ? "WAITING_FOR_REPOSITORY" : "RECEIVED";
  }
  return FROM_INTERNAL[status as A2ATaskStatus] ?? "RECEIVED";
}

export const IMMEDIATE_TASK_ACKNOWLEDGEMENT = [
  "RepoDiet received your repository-cleanup task.",
  "",
  "I can scan the repository, create an evidence-backed cleanup plan,",
  "negotiate the scope and price, then deliver a verified pull request.",
  "",
  "Please provide the repository URL or connect the RepoDiet GitHub App.",
].join("\n");

export const IMMEDIATE_TASK_ACKNOWLEDGEMENT_SHORT =
  "RepoDiet received your repository-cleanup task. Provide the repository URL or connect the RepoDiet GitHub App. I will analyze it, prepare an exact cleanup plan and quote, and deliver a verified PR after OKX escrow is funded.";
