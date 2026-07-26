import { createHash } from "node:crypto";

export type BuyerTaskAction =
  | "record_provider_response"
  | "select_payment_mode"
  | "accept_quote"
  | "fund_escrow"
  | "start_work"
  | "scan_repository"
  | "create_branch"
  | "create_pull_request";

export interface BuyerTaskPolicy {
  availabilityOnly: boolean;
  startWork: boolean;
  fundEscrow: boolean;
  repositoryScan: boolean;
  createBranch: boolean;
  createPullRequest: boolean;
  paymentAuthorised: boolean;
}

export interface PaymentApproval {
  jobId: string;
  serviceId: string;
  operation: string;
  network: string;
  asset: string;
  amountAtomic: string;
  recipient: string;
  idempotencyKey: string;
  approvedAt: string;
}

const DEFAULT_POLICY: BuyerTaskPolicy = {
  availabilityOnly: false,
  startWork: false,
  fundEscrow: false,
  repositoryScan: false,
  createBranch: false,
  createPullRequest: false,
  paymentAuthorised: false,
};

function flag(input: Record<string, unknown>, key: keyof BuyerTaskPolicy): boolean {
  return input[key] === true;
}

export function parseBuyerTaskPolicy(input: Record<string, unknown>): BuyerTaskPolicy {
  const policy = {
    ...DEFAULT_POLICY,
    availabilityOnly: flag(input, "availabilityOnly"),
    startWork: flag(input, "startWork"),
    fundEscrow: flag(input, "fundEscrow"),
    repositoryScan: flag(input, "repositoryScan"),
    createBranch: flag(input, "createBranch"),
    createPullRequest: flag(input, "createPullRequest"),
    paymentAuthorised: flag(input, "paymentAuthorised"),
  };

  if (policy.availabilityOnly) {
    return { ...DEFAULT_POLICY, availabilityOnly: true };
  }
  return policy;
}

export function taskPolicyAllows(policy: BuyerTaskPolicy, action: BuyerTaskAction): boolean {
  if (action === "record_provider_response") return true;
  if (policy.availabilityOnly) return false;

  switch (action) {
    case "select_payment_mode":
    case "accept_quote":
      return policy.startWork && policy.paymentAuthorised;
    case "fund_escrow":
      return policy.startWork && policy.fundEscrow && policy.paymentAuthorised;
    case "start_work":
      return policy.startWork;
    case "scan_repository":
      return policy.startWork && policy.repositoryScan;
    case "create_branch":
      return policy.startWork && policy.createBranch;
    case "create_pull_request":
      return policy.startWork && policy.createBranch && policy.createPullRequest;
  }
}

function canonicalApproval(input: Omit<PaymentApproval, "approvedAt">): string {
  return JSON.stringify({
    amountAtomic: input.amountAtomic,
    asset: input.asset.toLowerCase(),
    idempotencyKey: input.idempotencyKey,
    jobId: input.jobId,
    network: input.network,
    operation: input.operation,
    recipient: input.recipient.toLowerCase(),
    serviceId: input.serviceId,
  });
}

export function paymentApprovalDigest(input: Omit<PaymentApproval, "approvedAt">): string {
  return `sha256:${createHash("sha256").update(canonicalApproval(input)).digest("hex")}`;
}

export function assertExactPaymentApproval(
  approval: PaymentApproval | undefined,
  expected: Omit<PaymentApproval, "approvedAt">
): void {
  if (!approval) throw new Error("payment_approval_required");
  const actualDigest = paymentApprovalDigest(approval);
  const expectedDigest = paymentApprovalDigest(expected);
  if (actualDigest !== expectedDigest) throw new Error("payment_approval_mismatch");
}
