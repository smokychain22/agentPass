import type { AspDeliveryResponse, AspJobRecord, AspVerificationResult } from "./types";

function mapCheckStatus(
  status?: "passed" | "failed" | "blocked" | "skipped" | "not_generated" | "pending_worker" | "not_run"
): AspVerificationResult[keyof AspVerificationResult] {
  if (status === "passed") return "passed";
  if (status === "failed" || status === "blocked") return "failed";
  if (status === "skipped" || status === "not_generated" || status === "pending_worker") return "skipped";
  return "not_run";
}

export function buildAspVerificationResult(
  job: AspJobRecord
): AspVerificationResult | undefined {
  if (job.verificationStatus) return job.verificationStatus;

  const patch = mapCheckStatus(job.patchValidationStatus);
  return {
    patch,
    typecheck: "not_run",
    lint: "not_run",
    test: "not_run",
    build: "not_run",
  };
}

export function buildAspDeliveryResponse(job: AspJobRecord): AspDeliveryResponse {
  const repository = `${job.repositoryOwner}/${job.repositoryName}`;

  if (job.status === "failed") {
    return {
      status: "failed",
      repository,
      baseBranch: job.baseBranch,
      baseCommitSha: job.baseCommitSha,
      failureCode: job.failureCode,
      failureMessage: job.failureMessage,
    };
  }

  if (job.status !== "delivered") {
    return {
      status: "pending",
      repository,
      baseBranch: job.baseBranch,
      baseCommitSha: job.baseCommitSha,
    };
  }

  const hasRealChanges = (job.filesEdited ?? 0) + (job.filesDeleted ?? 0) > 0;
  const patchOk = job.patchValidationStatus === "passed";
  const prOk = Boolean(job.pullRequestUrl && job.cleanupCommitSha);
  const mainUntouched = job.defaultBranchChanged !== true;

  if (!hasRealChanges || !patchOk || !prOk || !mainUntouched) {
    return {
      status: "pending",
      repository,
      baseBranch: job.baseBranch,
      baseCommitSha: job.baseCommitSha,
      failureCode: job.failureCode,
      failureMessage: "Delivery proof is incomplete.",
    };
  }

  return {
    status: "delivered",
    repository,
    baseBranch: job.baseBranch,
    baseCommitSha: job.baseCommitSha,
    cleanupBranch: job.cleanupBranch,
    cleanupCommitSha: job.cleanupCommitSha,
    pullRequestUrl: job.pullRequestUrl,
    filesEdited: job.filesEdited,
    filesDeleted: job.filesDeleted,
    linesAdded: job.linesAdded,
    linesRemoved: job.linesRemoved,
    verification: buildAspVerificationResult(job),
    protectedFilesChanged: job.protectedFilesChanged ?? 0,
    defaultBranchChanged: job.defaultBranchChanged ?? false,
  };
}

export function buildAspJobStatusResponse(job: AspJobRecord, githubInstallationUrl?: string) {
  return {
    jobId: job.id,
    okxOrderId: job.okxOrderId,
    status: job.status,
    repository: `${job.repositoryOwner}/${job.repositoryName}`,
    baseBranch: job.baseBranch,
    baseCommitSha: job.baseCommitSha,
    githubInstallationUrl,
    failureCode: job.failureCode,
    failureMessage: job.failureMessage,
    pullRequestUrl: job.pullRequestUrl,
    updatedAt: job.updatedAt,
  };
}
