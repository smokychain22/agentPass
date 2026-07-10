import type { PaymentLifecycleStatus } from "./types";

export type FailureScenario =
  | "unsupported_repository"
  | "user_cancelled"
  | "analysis_only"
  | "verification_failed"
  | "platform_failure"
  | "duplicate_request"
  | "expired"
  | "invalid_payment";

export interface FailurePolicyResult {
  action: string;
  lifecycleStatus: PaymentLifecycleStatus;
  charge: boolean;
  credit: boolean;
}

const POLICIES: Record<FailureScenario, FailurePolicyResult> = {
  unsupported_repository: {
    action: "No charge — unsupported repository rejected before work.",
    lifecycleStatus: "credited",
    charge: false,
    credit: true,
  },
  user_cancelled: {
    action: "Credit/refund before execution starts.",
    lifecycleStatus: "refunded",
    charge: false,
    credit: true,
  },
  analysis_only: {
    action: "Charge only for disclosed analysis tier when no safe fix retained.",
    lifecycleStatus: "completed",
    charge: true,
    credit: false,
  },
  verification_failed: {
    action: "Return verification evidence; no completion status. Policy: no PR charge on failed verification.",
    lifecycleStatus: "execution_failed",
    charge: false,
    credit: false,
  },
  platform_failure: {
    action: "Platform failure — automatic credit/refund.",
    lifecycleStatus: "credited",
    charge: false,
    credit: true,
  },
  duplicate_request: {
    action: "Return existing task — do not charge twice.",
    lifecycleStatus: "funded",
    charge: false,
    credit: false,
  },
  expired: {
    action: "Quote expired — request a new quote.",
    lifecycleStatus: "expired",
    charge: false,
    credit: false,
  },
  invalid_payment: {
    action: "Invalid payment — no entitlement granted.",
    lifecycleStatus: "invalid_payment",
    charge: false,
    credit: false,
  },
};

export function applyFailurePolicy(scenario: FailureScenario): FailurePolicyResult {
  return POLICIES[scenario];
}

export const FAILURE_POLICY_DOCUMENT = Object.entries(POLICIES).map(([key, value]) => ({
  scenario: key,
  ...value,
}));
