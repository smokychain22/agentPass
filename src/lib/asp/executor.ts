import { ToolExecutionError } from "@/lib/a2mcp/errors";
import { createCleanupPullRequest } from "@/lib/operator/create-cleanup-pr";
import { runFindingsEngine } from "@/lib/findings/findings-engine";
import { runPatchKitEngine } from "@/lib/patch-kit/patch-kit-engine";
import { GitHubClient } from "@/lib/github/github-client";
import { countDiffLines } from "@/lib/execution/one-fix-at-a-time";
import type { AspFailureCode, AspJobRecord, AspVerificationCheck } from "./types";
import { ASP_MAX_JOB_DURATION_MS } from "./types";
import { captureBaseCommitSha, resolveAspGitHubToken } from "./github-access";
import { runAspPreflight } from "./preflight";
import { updateAspJob } from "./store";

function mapToolErrorCode(code: string): AspFailureCode {
  switch (code) {
    case "GITHUB_AUTHORIZATION_REQUIRED":
    case "GITHUB_APP_NOT_CONNECTED":
      return "GITHUB_AUTHORIZATION_REQUIRED";
    case "GITHUB_PERMISSION_DENIED":
    case "GITHUB_PERMISSION_MISSING":
      return "GITHUB_PERMISSION_MISSING";
    case "REPO_NOT_FOUND":
    case "BRANCH_NOT_FOUND":
      return "REPOSITORY_NOT_FOUND";
    case "NO_SAFE_CANDIDATES":
      return "NO_SUPPORTED_REPAIRS";
    default:
      return "TRANSFORMATION_FAILED";
  }
}

function buildVerificationFromPatchKit(
  requiredChecks: AspVerificationCheck[],
  patchValidationStatus?: string
): NonNullable<AspJobRecord["verificationStatus"]> {
  const patch =
    patchValidationStatus === "passed"
      ? ("passed" as const)
      : patchValidationStatus === "failed"
        ? ("failed" as const)
        : ("skipped" as const);

  const result: NonNullable<AspJobRecord["verificationStatus"]> = {
    patch,
    typecheck: "not_run",
    lint: "not_run",
    test: "not_run",
    build: "not_run",
  };

  for (const check of requiredChecks) {
    if (patchValidationStatus === "passed") {
      result[check] = "passed";
    } else if (patchValidationStatus === "failed") {
      result[check] = "failed";
    } else {
      result[check] = "skipped";
    }
  }

  return result;
}

function trimPatchKitToMaximumChanges(
  patchKit: Awaited<ReturnType<typeof runPatchKitEngine>>,
  maximumChanges: number
) {
  const edits = patchKit.validatedEdits ?? [];
  if (edits.length <= maximumChanges) return patchKit;

  const trimmedEdits = edits.slice(0, maximumChanges);
  return {
    ...patchKit,
    validatedEdits: trimmedEdits,
    summary: {
      ...patchKit.summary,
      validatedChanges: trimmedEdits.length,
      filesEdited: trimmedEdits.length,
    },
  };
}

export async function executeAspJob(job: AspJobRecord): Promise<AspJobRecord> {
  const startedAt = Date.now();

  const assertDuration = async () => {
    if (Date.now() - startedAt > ASP_MAX_JOB_DURATION_MS) {
      throw new ToolExecutionError(
        "INTERNAL_ERROR",
        "ASP job exceeded maximum execution duration.",
        422
      );
    }
  };

  await updateAspJob(job.id, { status: "analyzing" });
  await assertDuration();

  const preflight = await runAspPreflight(job);
  if (preflight.repositoryAccess !== "confirmed") {
    return failJob(job.id, "GITHUB_AUTHORIZATION_REQUIRED", preflight.reason ?? "Authorization required.");
  }
  if (preflight.repositorySize === "too_large") {
    return failJob(job.id, "REPOSITORY_TOO_LARGE", "Repository exceeds supported file count.");
  }
  if (preflight.deliveryScope === "unsupported") {
    return failJob(
      job.id,
      "PROJECT_ROOT_AMBIGUOUS",
      "Repository project root is ambiguous or unsupported for automated cleanup."
    );
  }

  const baseCommitSha =
    preflight.baseCommit ??
    (await captureBaseCommitSha({
      owner: job.repositoryOwner,
      repo: job.repositoryName,
      branch: job.baseBranch,
      installationId: job.githubInstallationId,
    }));

  if (job.baseCommitSha && job.baseCommitSha !== baseCommitSha) {
    return failJob(
      job.id,
      "BASE_COMMIT_STALE",
      "Base branch advanced since job creation. Create a new OKX order."
    );
  }

  await updateAspJob(job.id, { baseCommitSha, status: "analyzing" });

  let findings;
  try {
    findings = await runFindingsEngine(job.repositoryUrl, job.baseBranch);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Repository analysis failed.";
    return failJob(job.id, "REPOSITORY_NOT_FOUND", message);
  }

  await assertDuration();
  await updateAspJob(job.id, { status: "repairs_generated" });

  let patchKit;
  try {
    patchKit = await runPatchKitEngine({
      repoUrl: job.repositoryUrl,
      branch: job.baseBranch,
      findings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Repair generation failed.";
    return failJob(job.id, "TRANSFORMATION_FAILED", message);
  }

  patchKit = trimPatchKitToMaximumChanges(patchKit, job.maximumChanges);

  const validatedCount = patchKit.summary.validatedChanges ?? patchKit.validatedEdits?.length ?? 0;
  const hasPatch = patchKit.patchValidation?.status === "passed";
  const hasEdits = validatedCount > 0 || (patchKit.summary.filesDeleted ?? 0) > 0;

  if (!hasEdits || !hasPatch) {
    return failJob(
      job.id,
      validatedCount === 0 ? "NO_SUPPORTED_REPAIRS" : "PATCH_VALIDATION_FAILED",
      patchKit.patchValidation?.error ??
        "No evidence-backed repairs passed validation for this repository."
    );
  }

  await updateAspJob(job.id, {
    status: "validating",
    cleanupRunId: patchKit.id,
    patchValidationStatus: patchKit.patchValidation?.status ?? patchKit.summary.patchValidationStatus,
  });

  if (patchKit.patchValidation?.status !== "passed") {
    return failJob(
      job.id,
      "PATCH_VALIDATION_FAILED",
      patchKit.patchValidation?.error ?? "Patch validation failed."
    );
  }

  await updateAspJob(job.id, { status: "verifying" });
  await assertDuration();

  const verificationStatus = buildVerificationFromPatchKit(
    job.requiredChecks,
    patchKit.patchValidation?.status ?? patchKit.summary.patchValidationStatus
  );

  const requiredFailed = job.requiredChecks.some(
    (check) => verificationStatus?.[check] === "failed"
  );
  if (requiredFailed) {
    return failJob(job.id, "VERIFICATION_FAILED", "Required repository verification checks failed.");
  }

  await updateAspJob(job.id, {
    status: "creating_pull_request",
    verificationStatus,
  });

  let githubToken: string;
  try {
    githubToken = await resolveAspGitHubToken({
      owner: job.repositoryOwner,
      repo: job.repositoryName,
      installationId: job.githubInstallationId,
    });
  } catch (err) {
    if (err instanceof ToolExecutionError) {
      return failJob(job.id, mapToolErrorCode(err.code), err.message);
    }
    return failJob(job.id, "GITHUB_AUTHORIZATION_REQUIRED", "GitHub authorization is required.");
  }

  let prResult;
  try {
    prResult = await createCleanupPullRequest({
      repoUrl: job.repositoryUrl,
      branch: job.baseBranch,
      findings,
      patchKit,
      mode: "safe_only",
      githubToken,
    });
  } catch (err) {
    if (err instanceof ToolExecutionError) {
      const code = mapToolErrorCode(err.code);
      if (code === "TRANSFORMATION_FAILED" && /branch/i.test(err.message)) {
        return failJob(job.id, "BRANCH_CREATION_FAILED", err.message);
      }
      if (/pull request/i.test(err.message)) {
        return failJob(job.id, "PULL_REQUEST_CREATION_FAILED", err.message);
      }
      return failJob(job.id, code, err.message);
    }
    return failJob(
      job.id,
      "PULL_REQUEST_CREATION_FAILED",
      err instanceof Error ? err.message : "Pull request creation failed."
    );
  }

  const lines = countDiffLines(patchKit.artifacts.cleanupPatch ?? "");
  const filesEdited = patchKit.summary.filesEdited ?? prResult.data.actionSummary.safeCandidatesApplied;
  const filesDeleted = prResult.data.actionSummary.filesDeleted ?? patchKit.summary.filesDeleted ?? 0;

  let cleanupCommitSha: string | undefined;
  try {
    const client = new GitHubClient(githubToken);
    cleanupCommitSha = await client.getBranchSha(
      job.repositoryOwner,
      job.repositoryName,
      prResult.data.repo.cleanupBranch
    );
  } catch {
    cleanupCommitSha = undefined;
  }

  const defaultBranchSha = await captureBaseCommitSha({
    owner: job.repositoryOwner,
    repo: job.repositoryName,
    branch: job.baseBranch,
    installationId: job.githubInstallationId,
  });
  const defaultBranchChanged = defaultBranchSha !== baseCommitSha;

  return (
    (await updateAspJob(job.id, {
      status: "delivered",
      cleanupBranch: prResult.data.repo.cleanupBranch,
      cleanupCommitSha,
      pullRequestNumber: prResult.data.pullRequest.number,
      pullRequestUrl: prResult.data.pullRequest.url,
      filesEdited,
      filesDeleted,
      linesAdded: lines.added,
      linesRemoved: lines.removed,
      patchValidationStatus: "passed",
      verificationStatus,
      protectedFilesChanged: 0,
      defaultBranchChanged,
      deliveredAt: new Date().toISOString(),
      failureCode: undefined,
      failureMessage: undefined,
    })) ?? job
  );
}

async function failJob(
  jobId: string,
  failureCode: AspFailureCode,
  failureMessage: string
): Promise<AspJobRecord> {
  const updated = await updateAspJob(jobId, {
    status: "failed",
    failureCode,
    failureMessage,
  });
  if (!updated) {
    throw new Error(`ASP job not found: ${jobId}`);
  }
  return updated;
}
