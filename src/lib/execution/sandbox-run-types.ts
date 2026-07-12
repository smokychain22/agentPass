import type { ChangeOperation } from "@/lib/patch-kit/canonical-patch";
import type { CanonicalPatchValidationResult } from "@/lib/patch-kit/canonical-patch";
import type { RepositoryVerificationResult } from "@/lib/patch-kit/repository-verification";

export type SandboxRunStatus =
  | "queued"
  | "starting"
  | "resolving_repository"
  | "creating_sandbox"
  | "cloning"
  | "baseline_verification"
  | "applying_operations"
  | "generating_patch"
  | "git_validation"
  | "patched_verification"
  | "persisting_results"
  | "ready_for_delivery"
  | "delivered"
  | "failed"
  | "blocked"
  | "timed_out";

export interface SandboxRunPayload {
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
  installationId?: number;
}

export interface SandboxRunResult {
  patchValidation?: CanonicalPatchValidationResult;
  repositoryVerification?: RepositoryVerificationResult;
  gitVersion?: string;
  nodeVersion?: string;
  npmVersion?: string;
  patchHash?: string;
  sandboxId?: string;
  logs?: string[];
}

export interface SandboxRun {
  id: string;
  cleanupRunId: string;
  workflowRunId?: string;
  sandboxId?: string;
  repositoryOwner: string;
  repositoryName: string;
  branch: string;
  baseCommitSha: string;
  status: SandboxRunStatus;
  progress?: string;
  failureCode?: string;
  failureMessage?: string;
  executionDispatchedAt?: string;
  payload: SandboxRunPayload;
  result?: SandboxRunResult;
  statusHistory?: Array<{ status: SandboxRunStatus; at: string; detail?: string }>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export const SANDBOX_TIMEOUT_MS = 30 * 60 * 1000;
