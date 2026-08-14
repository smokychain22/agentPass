import type { CanonicalPatchValidationResult } from "@/lib/patch-kit/canonical-patch";
import { formatPatchValidationUserMessage } from "@/lib/patch-kit/canonical-patch";
import {
  assertSandboxRunClaim,
  completeSandboxRun,
  failSandboxRun,
  getSandboxRun,
  isTerminalSandboxStatus,
  SandboxRunClaimError,
  updateSandboxRun,
} from "./sandbox-run-store";
import type { SandboxRun } from "./sandbox-run-types";
import {
  persistSandboxFailureToPatchKit,
  persistSandboxResultsToPatchKit,
} from "./persist-sandbox-results";

/**
 * What an external worker (GitHub Actions on-demand validate job) reports back.
 * This is UNTRUSTED input — `completeSandboxRunFromWorker` re-derives the
 * authoritative outcome from it rather than storing it verbatim.
 */
export interface SandboxWorkerReport {
  status: "passed" | "failed";
  baseCommitSha: string;
  validatedPaths?: string[];
  gitApplyExitCode?: number;
  gitApplyStderr?: string;
  patchHash?: string;
  gitVersion?: string;
  error?: string;
  workflowRunId?: string;
  workflowRunUrl?: string;
}

export type SandboxVerificationOutcome =
  | {
      ok: true;
      verifiedChanges: number;
      verifiedPaths: string[];
      patchValidation: CanonicalPatchValidationResult;
    }
  | {
      ok: false;
      failureCode:
        | "WORKER_REPORTED_FAILURE"
        | "BASE_COMMIT_MISMATCH"
        | "GIT_APPLY_FAILED"
        | "UNEXPECTED_CHANGED_PATH"
        | "MISSING_CHANGED_PATH";
      failureMessage: string;
    };

/**
 * Authoritative, server-side verification of a worker's reported result.
 *
 * Never trusts the worker's bare "passed" — cross-checks the reported base
 * commit and the exact set of changed paths against what this server actually
 * dispatched, so a worker that validated the wrong commit or a patch touching
 * different files than intended cannot be recorded as a pass.
 */
export function verifySandboxWorkerResult(
  run: SandboxRun,
  report: SandboxWorkerReport
): SandboxVerificationOutcome {
  if (report.status !== "passed") {
    return {
      ok: false,
      failureCode: "WORKER_REPORTED_FAILURE",
      failureMessage: report.error || report.gitApplyStderr || "Worker reported validation failure.",
    };
  }

  if (report.baseCommitSha !== run.payload.baseCommitSha) {
    return {
      ok: false,
      failureCode: "BASE_COMMIT_MISMATCH",
      failureMessage: `Worker validated commit ${report.baseCommitSha} but this run pins ${run.payload.baseCommitSha}.`,
    };
  }

  if (report.gitApplyExitCode !== 0) {
    return {
      ok: false,
      failureCode: "GIT_APPLY_FAILED",
      failureMessage: report.gitApplyStderr || "git apply --check did not exit 0.",
    };
  }

  const expectedPaths = run.payload.changeOperations.map((op) => op.filePath);
  const validatedPaths = report.validatedPaths ?? [];
  const unexpectedPaths = validatedPaths.filter((p) => !expectedPaths.includes(p));
  const missingPaths = expectedPaths.filter((p) => !validatedPaths.includes(p));

  if (unexpectedPaths.length > 0) {
    return {
      ok: false,
      failureCode: "UNEXPECTED_CHANGED_PATH",
      failureMessage: `Validated patch touched unexpected path(s): ${unexpectedPaths.join(", ")}`,
    };
  }
  if (missingPaths.length > 0) {
    return {
      ok: false,
      failureCode: "MISSING_CHANGED_PATH",
      failureMessage: `Validated patch is missing expected path(s): ${missingPaths.join(", ")}`,
    };
  }

  const patchHash = report.patchHash ?? "";
  return {
    ok: true,
    verifiedChanges: validatedPaths.length,
    verifiedPaths: validatedPaths,
    patchValidation: {
      status: "passed",
      gitCliAvailable: true,
      patchGenerationMethod: "git-cli",
      patchHash,
      validatedPaths,
      baseCommitSha: report.baseCommitSha,
      gitPatchValidation: { status: "passed" },
      contentIntegrityValidation: { status: "passed" },
    },
  };
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((v) => bSet.has(v));
}

/**
 * True when re-verifying `report` against `run` yields the exact outcome
 * already recorded on a terminal `run` — the basis for idempotent replay.
 * Any other outcome (including a different failure reason) is a conflict.
 */
function isEquivalentToRecordedOutcome(run: SandboxRun, outcome: SandboxVerificationOutcome): boolean {
  if (outcome.ok) {
    return run.status === "ready_for_delivery" && sameStringSet(run.verifiedPaths ?? [], outcome.verifiedPaths);
  }
  return run.status === "failed" && run.failureCode === outcome.failureCode;
}

export type SandboxCompletionResult =
  | { ok: true; run: SandboxRun; idempotent: boolean }
  | { ok: false; code: "NOT_FOUND" | "SANDBOX_RESULT_CONFLICT" | "CLAIM_MISMATCH" | "LEASE_EXPIRED"; message: string };

/**
 * Handle a worker's completion callback end-to-end: idempotency, claim
 * ownership, authoritative re-verification, and (only once verified)
 * persisting both the sandbox run and the downstream patch kit.
 */
export async function completeSandboxRunFromWorker(
  runId: string,
  workerId: string,
  claimToken: string,
  report: SandboxWorkerReport
): Promise<SandboxCompletionResult> {
  const run = await getSandboxRun(runId);
  if (!run) return { ok: false, code: "NOT_FOUND", message: "Sandbox run not found." };

  if (isTerminalSandboxStatus(run.status)) {
    const replay = verifySandboxWorkerResult(run, report);
    if (isEquivalentToRecordedOutcome(run, replay)) {
      return { ok: true, run, idempotent: true };
    }
    return {
      ok: false,
      code: "SANDBOX_RESULT_CONFLICT",
      message: "Sandbox run already has a different recorded outcome; refusing to overwrite a terminal result.",
    };
  }

  try {
    assertSandboxRunClaim(run, workerId, claimToken);
  } catch (err) {
    if (err instanceof SandboxRunClaimError) {
      return { ok: false, code: err.code === "LEASE_EXPIRED" ? "LEASE_EXPIRED" : "CLAIM_MISMATCH", message: err.message };
    }
    throw err;
  }

  const outcome = verifySandboxWorkerResult(run, report);

  if (outcome.ok) {
    const updated = await completeSandboxRun(
      runId,
      { patchValidation: outcome.patchValidation, patchHash: outcome.patchValidation.patchHash },
      "ready_for_delivery"
    );
    const withVerification = updated
      ? await updateSandboxRun(runId, {
          verifiedChanges: outcome.verifiedChanges,
          verifiedPaths: outcome.verifiedPaths,
          workflowRunId: report.workflowRunId ?? run.workflowRunId,
          workflowRunUrl: report.workflowRunUrl ?? run.workflowRunUrl,
          claimToken: undefined,
          leaseExpiresAt: undefined,
        })
      : updated;

    await persistSandboxResultsToPatchKit({
      cleanupRunId: run.cleanupRunId,
      patchValidation: outcome.patchValidation,
      repositoryVerification: { status: "not_run", installAttempts: [], checks: [] },
      sandboxRunId: runId,
      workflowRunId: report.workflowRunId ?? run.workflowRunId,
    });

    return { ok: true, run: withVerification ?? run, idempotent: false };
  }

  const userMessage =
    outcome.failureCode === "GIT_APPLY_FAILED"
      ? formatPatchValidationUserMessage({
          gitStderr: outcome.failureMessage,
          baseCommitSha: run.payload.baseCommitSha,
        })
      : outcome.failureMessage;

  await failSandboxRun(runId, outcome.failureCode, userMessage);
  const failed = await updateSandboxRun(runId, { claimToken: undefined, leaseExpiresAt: undefined });
  await persistSandboxFailureToPatchKit({
    cleanupRunId: run.cleanupRunId,
    failureCode: outcome.failureCode,
    failureMessage: userMessage,
    sandboxRunId: runId,
  });

  return { ok: true, run: failed ?? run, idempotent: false };
}
