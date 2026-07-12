export const ASP_JOB_STATUSES = [
  "authorization_required",
  "queued",
  "analyzing",
  "repairs_generated",
  "validating",
  "verifying",
  "creating_pull_request",
  "delivered",
  "failed",
] as const;

export type AspJobStatus = (typeof ASP_JOB_STATUSES)[number];

export const ASP_FAILURE_CODES = [
  "GITHUB_AUTHORIZATION_REQUIRED",
  "REPOSITORY_NOT_FOUND",
  "REPOSITORY_TOO_LARGE",
  "PROJECT_ROOT_AMBIGUOUS",
  "NO_SUPPORTED_REPAIRS",
  "TRANSFORMATION_FAILED",
  "PATCH_VALIDATION_FAILED",
  "VERIFICATION_FAILED",
  "BASE_COMMIT_STALE",
  "GITHUB_PERMISSION_MISSING",
  "BRANCH_CREATION_FAILED",
  "COMMIT_CREATION_FAILED",
  "PULL_REQUEST_CREATION_FAILED",
] as const;

export type AspFailureCode = (typeof ASP_FAILURE_CODES)[number];

export const ASP_CLEANUP_MODES = ["safe"] as const;
export type AspCleanupMode = (typeof ASP_CLEANUP_MODES)[number];

export const ASP_VERIFICATION_CHECKS = ["typecheck", "lint", "test", "build"] as const;
export type AspVerificationCheck = (typeof ASP_VERIFICATION_CHECKS)[number];

export interface AspVerificationResult {
  patch: "passed" | "failed" | "skipped" | "not_run";
  typecheck: "passed" | "failed" | "skipped" | "not_run";
  lint: "passed" | "failed" | "skipped" | "not_run";
  test: "passed" | "failed" | "skipped" | "not_run";
  build: "passed" | "failed" | "skipped" | "not_run";
}

export interface AspJobRecord {
  id: string;
  okxOrderId: string;
  userId?: string;
  repositoryOwner: string;
  repositoryName: string;
  repositoryUrl: string;
  baseBranch: string;
  baseCommitSha?: string;
  githubInstallationId?: number;
  cleanupMode: AspCleanupMode;
  maximumChanges: number;
  requiredChecks: AspVerificationCheck[];
  status: AspJobStatus;
  failureCode?: AspFailureCode;
  failureMessage?: string;
  cleanupRunId?: string;
  cleanupBranch?: string;
  cleanupCommitSha?: string;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  filesEdited?: number;
  filesDeleted?: number;
  linesAdded?: number;
  linesRemoved?: number;
  patchValidationStatus?: "passed" | "failed" | "blocked" | "skipped" | "not_generated" | "pending_sandbox";
  verificationStatus?: AspVerificationResult;
  protectedFilesChanged?: number;
  defaultBranchChanged?: boolean;
  installStateToken?: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
}

export interface CreateAspJobInput {
  okxOrderId: string;
  repositoryUrl: string;
  baseBranch?: string;
  cleanupMode?: string;
  maximumChanges?: number;
  requiredChecks?: string[];
  userId?: string;
}

export interface AspJobCreateResponse {
  jobId: string;
  status: AspJobStatus;
  githubInstallationUrl?: string;
  failureCode?: AspFailureCode;
  failureMessage?: string;
}

export interface AspJobStatusResponse {
  jobId: string;
  okxOrderId: string;
  status: AspJobStatus;
  repository: string;
  baseBranch: string;
  baseCommitSha?: string;
  githubInstallationUrl?: string;
  failureCode?: AspFailureCode;
  failureMessage?: string;
  pullRequestUrl?: string;
  updatedAt: string;
}

export interface AspDeliveryResponse {
  status: "delivered" | "pending" | "failed";
  repository: string;
  baseBranch: string;
  baseCommitSha?: string;
  cleanupBranch?: string;
  cleanupCommitSha?: string;
  pullRequestUrl?: string;
  filesEdited?: number;
  filesDeleted?: number;
  linesAdded?: number;
  linesRemoved?: number;
  verification?: AspVerificationResult;
  protectedFilesChanged?: number;
  defaultBranchChanged?: boolean;
  failureCode?: AspFailureCode;
  failureMessage?: string;
}

export const ASP_MAXIMUM_CHANGES_LIMIT = 50;
export const ASP_MAX_REPOSITORY_FILES = 25_000;
export const ASP_MAX_JOB_DURATION_MS = 15 * 60 * 1000;
