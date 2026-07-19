/**
 * User-facing failure states — never expose raw CLI/API noise as the primary message.
 */

export type ProductFailureCode =
  | "GITHUB_ACCESS_REQUIRED"
  | "REPOSITORY_NOT_IN_INSTALLATION"
  | "REPOSITORY_CHANGED_SINCE_SCAN"
  | "NO_SAFE_CHANGES_FOUND"
  | "VALIDATION_FAILED"
  | "DEPLOYMENT_OWNER_ACTION_REQUIRED"
  | "GITHUB_CHECKS_FAILED"
  | "PAYMENT_AWAITING_CONFIRMATION"
  | "FUNDED_TASK_READY"
  | "APPROVAL_REQUIRED"
  | "PULL_REQUEST_CREATED"
  | "BUYER_ACCEPTANCE_REQUIRED"
  | "ESCROW_RELEASED"
  | "UNSUPPORTED_TRANSFORMATION"
  | "PLATFORM_FAILURE_RETRYABLE";

export interface ProductFailureView {
  code: ProductFailureCode;
  title: string;
  whatFailed: string;
  why: string;
  paymentTaken: boolean;
  paymentStillUsable: boolean;
  repositoryFilesChanged: boolean;
  branchOrPrExists: boolean;
  retrySafe: boolean;
  nextAction: string;
}

const CATALOG: Record<ProductFailureCode, Omit<ProductFailureView, "code">> = {
  GITHUB_ACCESS_REQUIRED: {
    title: "GitHub access required",
    whatFailed: "RepoDiet could not write a cleanup branch or pull request.",
    why: "The RepoDiet GitHub App is not installed or authorized for this repository.",
    paymentTaken: false,
    paymentStillUsable: true,
    repositoryFilesChanged: false,
    branchOrPrExists: false,
    retrySafe: true,
    nextAction: "Install the RepoDiet GitHub App on the target repository, then retry delivery.",
  },
  REPOSITORY_NOT_IN_INSTALLATION: {
    title: "Repository not included in installation",
    whatFailed: "GitHub App is installed but this repository was not selected.",
    why: "Installation access does not include the requested repository.",
    paymentTaken: false,
    paymentStillUsable: true,
    repositoryFilesChanged: false,
    branchOrPrExists: false,
    retrySafe: true,
    nextAction: "Add the repository to the GitHub App installation and retry.",
  },
  REPOSITORY_CHANGED_SINCE_SCAN: {
    title: "Repository changed since scan",
    whatFailed: "The pinned commit no longer matches the repository tip.",
    why: "Source drift invalidates the approved plan and quote.",
    paymentTaken: false,
    paymentStillUsable: false,
    repositoryFilesChanged: false,
    branchOrPrExists: false,
    retrySafe: true,
    nextAction: "Rescan the repository and approve a new plan before payment.",
  },
  NO_SAFE_CHANGES_FOUND: {
    title: "No safe changes found",
    whatFailed: "RepoDiet did not find evidence-backed cleanup candidates.",
    why: "Findings were review-first, protected, or unsupported for automatic change.",
    paymentTaken: false,
    paymentStillUsable: false,
    repositoryFilesChanged: false,
    branchOrPrExists: false,
    retrySafe: true,
    nextAction: "Review findings or request Guided Review for uncertain items.",
  },
  VALIDATION_FAILED: {
    title: "Validation failed",
    whatFailed: "Required checks failed after applying the approved patch.",
    why: "Baseline or patched typecheck/build/tests did not pass.",
    paymentTaken: true,
    paymentStillUsable: true,
    repositoryFilesChanged: false,
    branchOrPrExists: false,
    retrySafe: true,
    nextAction: "Inspect validation evidence, adjust scope, and retry with the same funded entitlement when eligible.",
  },
  DEPLOYMENT_OWNER_ACTION_REQUIRED: {
    title: "Deployment configuration needs owner action",
    whatFailed: "Repository configuration prevents safe automated repair.",
    why: "Build, environment, or platform settings require an owner decision.",
    paymentTaken: true,
    paymentStillUsable: true,
    repositoryFilesChanged: false,
    branchOrPrExists: false,
    retrySafe: false,
    nextAction: "Follow the OWNER_ACTION_REQUIRED details, then request a revision.",
  },
  GITHUB_CHECKS_FAILED: {
    title: "GitHub checks failed",
    whatFailed: "Required pull-request checks did not pass.",
    why: "GitHub reported failing required status checks on the cleanup PR.",
    paymentTaken: true,
    paymentStillUsable: true,
    repositoryFilesChanged: true,
    branchOrPrExists: true,
    retrySafe: true,
    nextAction: "Review check diagnosis; authorize a bounded repair iteration or accept owner action.",
  },
  PAYMENT_AWAITING_CONFIRMATION: {
    title: "Payment awaiting confirmation",
    whatFailed: "Payment proof is not yet verified.",
    why: "Escrow or x402 settlement has not confirmed on-chain.",
    paymentTaken: false,
    paymentStillUsable: false,
    repositoryFilesChanged: false,
    branchOrPrExists: false,
    retrySafe: true,
    nextAction: "Wait for confirmation or resubmit the payment proof for the same quote.",
  },
  FUNDED_TASK_READY: {
    title: "Funded task ready for execution",
    whatFailed: "Nothing failed — escrow is funded and execution can proceed.",
    why: "Funding verification succeeded for the bound task and plan.",
    paymentTaken: true,
    paymentStillUsable: true,
    repositoryFilesChanged: false,
    branchOrPrExists: false,
    retrySafe: true,
    nextAction: "Approve the exact plan so RepoDiet can execute in isolation.",
  },
  APPROVAL_REQUIRED: {
    title: "Approval required",
    whatFailed: "Delivery is paused for buyer approval.",
    why: "Exact diff is ready but repository writes wait for explicit approval.",
    paymentTaken: true,
    paymentStillUsable: true,
    repositoryFilesChanged: false,
    branchOrPrExists: false,
    retrySafe: true,
    nextAction: "Review the exact unified diff and approve delivery.",
  },
  PULL_REQUEST_CREATED: {
    title: "Pull request created",
    whatFailed: "Nothing failed — cleanup PR exists.",
    why: "Approved changes were pushed to a cleanup branch and opened as a PR.",
    paymentTaken: true,
    paymentStillUsable: false,
    repositoryFilesChanged: true,
    branchOrPrExists: true,
    retrySafe: false,
    nextAction: "Review the pull request and accept delivery in OKX when checks pass.",
  },
  BUYER_ACCEPTANCE_REQUIRED: {
    title: "Buyer acceptance required",
    whatFailed: "Escrow release waits for marketplace acceptance.",
    why: "Delivery was submitted; OKX buyer must accept before release.",
    paymentTaken: true,
    paymentStillUsable: false,
    repositoryFilesChanged: true,
    branchOrPrExists: true,
    retrySafe: false,
    nextAction: "Accept the verified delivery in the OKX task to release escrow.",
  },
  ESCROW_RELEASED: {
    title: "Escrow released",
    whatFailed: "Nothing failed — settlement completed.",
    why: "Buyer accepted delivery and escrow release was recorded.",
    paymentTaken: true,
    paymentStillUsable: false,
    repositoryFilesChanged: true,
    branchOrPrExists: true,
    retrySafe: false,
    nextAction: "Retain the signed receipt and attestation for audit.",
  },
  UNSUPPORTED_TRANSFORMATION: {
    title: "Transformation unavailable",
    whatFailed: "RepoDiet cannot safely apply the requested change automatically.",
    why: "No supported transformer exists for this request, or evidence is incomplete.",
    paymentTaken: false,
    paymentStillUsable: false,
    repositoryFilesChanged: false,
    branchOrPrExists: false,
    retrySafe: true,
    nextAction: "Choose a supported operation or provide a more specific bounded request.",
  },
  PLATFORM_FAILURE_RETRYABLE: {
    title: "Temporary platform failure",
    whatFailed: "A platform dependency failed while processing the task.",
    why: "Worker, GitHub, or payment infrastructure returned a retryable error.",
    paymentTaken: true,
    paymentStillUsable: true,
    repositoryFilesChanged: false,
    branchOrPrExists: false,
    retrySafe: true,
    nextAction: "Retry the same funded task; do not create a second payment.",
  },
};

export function productFailure(code: ProductFailureCode): ProductFailureView {
  return { code, ...CATALOG[code] };
}

export function mapTechnicalErrorToProductFailure(message: string): ProductFailureView {
  const m = message.toLowerCase();
  if (/app not installed|installation|github app|token missing|gh auth|enoent/.test(m)) {
    return productFailure("GITHUB_ACCESS_REQUIRED");
  }
  if (/not included|repository not selected|wrong account/.test(m)) {
    return productFailure("REPOSITORY_NOT_IN_INSTALLATION");
  }
  if (/commit.*changed|source drift|pinned commit|stale commit/.test(m)) {
    return productFailure("REPOSITORY_CHANGED_SINCE_SCAN");
  }
  if (/transformer.?unavailable|unsupported transformation|empty patch/.test(m)) {
    return productFailure("UNSUPPORTED_TRANSFORMATION");
  }
  if (/typecheck|validation failed|build failed|tests failed/.test(m)) {
    return productFailure("VALIDATION_FAILED");
  }
  if (/checks? failed|required status/.test(m)) {
    return productFailure("GITHUB_CHECKS_FAILED");
  }
  return productFailure("PLATFORM_FAILURE_RETRYABLE");
}
