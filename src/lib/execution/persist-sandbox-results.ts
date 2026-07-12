import { buildProofLadderCounts } from "@/lib/execution/proof-ladder";
import type { CanonicalPatchValidationResult } from "@/lib/patch-kit/canonical-patch";
import { buildCleanupRunSummary } from "@/lib/patch-kit/cleanup-summary";
import { getStoredPatchKit, storePatchKit } from "@/lib/patch-kit/patch-kit-store";
import type { RepositoryVerificationResult } from "@/lib/patch-kit/repository-verification";
import type { PatchKitPayload } from "@/lib/patch-kit/types";

export async function persistSandboxResultsToPatchKit(input: {
  cleanupRunId: string;
  patchValidation: CanonicalPatchValidationResult;
  repositoryVerification: RepositoryVerificationResult;
  sandboxRunId?: string;
  workflowRunId?: string;
}): Promise<PatchKitPayload | null> {
  const stored = await getStoredPatchKit(input.cleanupRunId);
  if (!stored?.payload) return null;

  const { patchValidation, repositoryVerification } = input;
  const patchValidationStatus = patchValidation.status;
  const contentIntegrityPassed =
    patchValidation.contentIntegrityValidation?.status === "passed";

  const cleanupRunSummary = buildCleanupRunSummary({
    findings: stored.payload.artifacts.findingsJson!,
    summary: stored.payload.summary,
    candidateAudits: stored.payload.candidateAudits,
    changeOperations: stored.payload.changeOperations,
    verification: repositoryVerification,
    patchValidationStatus,
    contentIntegrityPassed,
  });

  const verified = repositoryVerification.status === "verified";
  const gitPassed = patchValidation.status === "passed";

  const candidateAudits = stored.payload.candidateAudits?.map((audit) => {
    if (!audit.transformAttempted || !audit.retained) return audit;
    if (!verified && !gitPassed) return audit;
    return {
      ...audit,
      patchValidated: gitPassed || audit.patchValidated,
      retained: verified,
    };
  });

  const transformerResults = stored.payload.transformerResults?.map((row) => {
    if (row.status !== "generated") return row;
    if (verified) {
      return { ...row, reason: "Verified and retained" };
    }
    if (gitPassed) {
      return {
        ...row,
        reason: "Git-validated; pending repository verification",
      };
    }
    return row;
  });

  const summary = {
    ...stored.payload.summary,
    patchValidationStatus,
    detectedFindings: cleanupRunSummary.detectedFindings,
    generatedChanges: cleanupRunSummary.generatedOperations,
    generatedFileOperations: cleanupRunSummary.generatedOperations,
    contentValidatedOperations: cleanupRunSummary.contentValidatedOperations,
    gitValidatedOperations: cleanupRunSummary.gitValidatedOperations,
    validatedChanges: cleanupRunSummary.gitValidatedOperations,
    validatedFileOperations: cleanupRunSummary.gitValidatedOperations,
    verifiedChanges: cleanupRunSummary.verifiedOperations,
    verifiedFileOperations: cleanupRunSummary.verifiedOperations,
    deliveredFileOperations: cleanupRunSummary.deliveredOperations,
    executedFindings: cleanupRunSummary.executedFindings,
    eligibleFindings: cleanupRunSummary.eligibleFindings,
    blockerSummary: verified
      ? `${cleanupRunSummary.verifiedOperations} verified file operation(s) ready for cleanup PR.`
      : gitPassed
        ? `${cleanupRunSummary.gitValidatedOperations} git-validated file operation(s); repository verification ${repositoryVerification.status}.`
        : stored.payload.summary.blockerSummary,
  };

  const proofLadder = buildProofLadderCounts({
    findings: stored.payload.artifacts.findingsJson,
    summary,
    verificationStatus:
      repositoryVerification.status === "verified"
        ? "passed"
        : repositoryVerification.status === "failed"
          ? "failed"
          : repositoryVerification.status === "blocked"
            ? "partial"
            : "pending",
  });

  const payload: PatchKitPayload = {
    ...stored.payload,
    patchValidation,
    repositoryVerification,
    sandboxRunId: input.sandboxRunId ?? stored.payload.sandboxRunId,
    workflowRunId: input.workflowRunId ?? stored.payload.workflowRunId,
    cleanupRunSummary,
    candidateAudits,
    transformerResults,
    summary: {
      ...summary,
      proofLadder: {
        ...proofLadder,
        detected: cleanupRunSummary.detectedFindings,
        eligible: cleanupRunSummary.eligibleFindings,
        executed: cleanupRunSummary.executedFindings,
        attempted: cleanupRunSummary.executedFindings,
        generated: cleanupRunSummary.generatedOperations,
        validated: cleanupRunSummary.gitValidatedOperations,
        contentValidated: cleanupRunSummary.contentValidatedOperations,
        gitValidated: cleanupRunSummary.gitValidatedOperations,
        verified: cleanupRunSummary.verifiedOperations,
        delivered: cleanupRunSummary.deliveredOperations,
        noop: cleanupRunSummary.noChangeExecutions,
        failed: cleanupRunSummary.failedExecutions,
        notAttempted: cleanupRunSummary.notAttempted,
        rejectedForSafety:
          cleanupRunSummary.reviewRequiredFindings + cleanupRunSummary.protectedFindings,
      },
    },
  };

  await storePatchKit(payload, stored.zipBuffer, stored.filename, stored.scanId);
  return payload;
}

export async function persistSandboxFailureToPatchKit(input: {
  cleanupRunId: string;
  failureCode: string;
  failureMessage: string;
  sandboxRunId?: string;
}): Promise<PatchKitPayload | null> {
  const stored = await getStoredPatchKit(input.cleanupRunId);
  if (!stored?.payload) return null;

  const priorContent = stored.payload.patchValidation?.contentIntegrityValidation;
  const contentIntegrityValidation =
    priorContent?.status === "passed"
      ? ({ status: "passed" } as const)
      : ({ status: "passed" } as const);

  const userMessage =
    input.failureCode === "GITHUB_REPOSITORY_NOT_GRANTED" ||
    input.failureMessage.includes("GITHUB_REPOSITORY_NOT_GRANTED")
      ? input.failureMessage.replace(/^GITHUB_REPOSITORY_NOT_GRANTED:\s*/, "")
      : input.failureMessage;

  return persistSandboxResultsToPatchKit({
    cleanupRunId: input.cleanupRunId,
    sandboxRunId: input.sandboxRunId,
    patchValidation: {
      status: "blocked",
      error: userMessage,
      userMessage,
      gitPatchValidation: {
        status: "blocked",
        failureCode: input.failureCode,
        error: userMessage,
      },
      contentIntegrityValidation: contentIntegrityValidation,
    },
    repositoryVerification: {
      status: "not_run",
      installAttempts: [],
      checks: [],
    },
  });
}
