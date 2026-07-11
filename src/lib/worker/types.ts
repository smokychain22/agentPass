import type { ChangeOperation } from "@/lib/patch-kit/canonical-patch";
import type { RepositoryVerificationResult } from "@/lib/patch-kit/repository-verification";
import type { CanonicalPatchValidationResult } from "@/lib/patch-kit/canonical-patch";

export type RepositoryJobStatus =
  | "queued"
  | "claimed"
  | "cloning"
  | "baseline_install"
  | "baseline_verify"
  | "transforming"
  | "generating_patch"
  | "validating_patch"
  | "patched_install"
  | "patched_verify"
  | "ready_for_delivery"
  | "delivering"
  | "delivered"
  | "failed"
  | "blocked"
  | "timed_out";

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
  startedAt?: string;
  completedAt?: string;
  failureCode?: string;
  failureMessage?: string;
  payload: RepositoryJobPayload;
  result?: RepositoryJobResult;
  progress?: string;
  createdAt: string;
  updatedAt: string;
}

export const STALE_JOB_MS = 10 * 60 * 1000;
