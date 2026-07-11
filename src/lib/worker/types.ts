import type { ChangeOperation } from "@/lib/patch-kit/canonical-patch";
import type { RepositoryVerificationResult } from "@/lib/patch-kit/repository-verification";
import type { CanonicalPatchValidationResult } from "@/lib/patch-kit/canonical-patch";

export type RepositoryJobStatus =
  | "queued"
  | "claimed"
  | "cloning"
  | "baseline_verification"
  | "baseline_install"
  | "baseline_verify"
  | "transforming"
  | "generating_patch"
  | "git_validation"
  | "validating_patch"
  | "patched_verification"
  | "patched_install"
  | "patched_verify"
  | "ready_for_delivery"
  | "delivering"
  | "delivered"
  | "failed"
  | "blocked"
  | "timed_out";

export type WorkerInstanceStatus = "starting" | "online" | "busy" | "degraded" | "offline";

export interface WorkerInstance {
  id: string;
  version: string;
  hostname: string;
  status: WorkerInstanceStatus;
  gitVersion?: string;
  nodeVersion?: string;
  npmVersion?: string;
  startedAt: string;
  heartbeatAt: string;
  currentJobId?: string;
  completedJobs: number;
  failedJobs: number;
}

export interface RepositoryJobPayload {
  cleanupRunId: string;
  scanId?: string;
  repositoryOwner: string;
  repositoryName: string;
  branch: string;
  baseCommitSha: string;
  repoUrl: string;
  edits: Array<{ path: string; content: string }>;
  changeOperations: ChangeOperation[];
  patch?: string;
}

export interface RepositoryJobResult {
  patchValidation?: CanonicalPatchValidationResult;
  repositoryVerification?: RepositoryVerificationResult;
  gitVersion?: string;
  patchHash?: string;
  logs?: string[];
}

export interface RepositoryJob {
  id: string;
  cleanupRunId: string;
  repositoryOwner: string;
  repositoryName: string;
  branch: string;
  baseCommitSha: string;
  status: RepositoryJobStatus;
  claimedBy?: string;
  claimedAt?: string;
  heartbeatAt?: string;
  leaseExpiresAt?: string;
  attemptCount?: number;
  startedAt?: string;
  completedAt?: string;
  failureCode?: string;
  failureMessage?: string;
  payload: RepositoryJobPayload;
  result?: RepositoryJobResult;
  progress?: string;
  statusHistory?: Array<{ status: RepositoryJobStatus; at: string; detail?: string }>;
  createdAt: string;
  updatedAt: string;
}

export const STALE_JOB_MS = 60 * 1000;
export const WORKER_HEARTBEAT_INTERVAL_MS = 10 * 1000;
export const WORKER_AVAILABILITY_WINDOW_MS = 30 * 1000;
export const MAX_JOB_ATTEMPTS = 2;
export const JOB_LEASE_MS = 60 * 1000;
