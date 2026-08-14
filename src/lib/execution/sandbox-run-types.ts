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

  // --- External-worker claim lease (GitHub Actions on-demand path) ---
  /** Opaque worker identity that currently owns this run (e.g. github-actions/ubuntu-latest). */
  claimedBy?: string;
  /** Server-side-only token; never sent to or accepted from an Actions runner. */
  claimToken?: string;
  /** Opaque, non-secret correlation id returned to the claim job (safe to log/artifact). */
  claimHandle?: string;
  claimedAt?: string;
  /** Claim expires and becomes reclaimable by another worker after this instant. */
  leaseExpiresAt?: string;
  /** Number of times this run has been claimed (first claim = 1). */
  claimAttempts?: number;
  workflowRunUrl?: string;
  workflowRunAttempt?: string;
  workflowName?: string;
  workflowRepository?: string;

  // --- Authoritative, server-verified outcome (never taken from the worker at face value) ---
  /** Count of file paths the server independently confirmed were validated. */
  verifiedChanges?: number;
  /** Exact set of file paths the server independently confirmed were validated. */
  verifiedPaths?: string[];
}

export const SANDBOX_TIMEOUT_MS = 30 * 60 * 1000;

/** Claim lease duration for an external worker (GitHub Actions on-demand validate job). */
export const SANDBOX_CLAIM_LEASE_MS = 10 * 60 * 1000;
