import { isGitHubAppConfigured } from "@/lib/github-app/config";
import { durableNow } from "@/lib/store/durable-store";
import type {
  AspJobCreateResponse,
  AspJobRecord,
  CreateAspJobInput,
} from "./types";
import {
  getAspJob,
  getAspJobByOrderId,
  newAspJobId,
  saveAspJob,
  updateAspJob,
} from "./store";
import { validateCreateAspJobInput } from "./validation";
import {
  buildAspGitHubInstallationUrl,
  buildAspInstallStateToken,
  findInstallationForRepository,
} from "./github-access";
import { buildAspDeliveryResponse, buildAspJobStatusResponse } from "./delivery";
import { executeAspJob } from "./executor";
import { runAspPreflight } from "./preflight";

export async function createAspJob(input: CreateAspJobInput): Promise<AspJobCreateResponse> {
  const validated = validateCreateAspJobInput(input);
  if (!validated.ok) {
    throw new Error(validated.error);
  }
  const value = validated.value;

  const existing = await getAspJobByOrderId(value.okxOrderId);
  if (existing) {
    return formatCreateResponse(existing);
  }

  const jobId = newAspJobId();
  const repositoryFullName = `${value.repositoryOwner}/${value.repositoryName}`;
  const installStateToken = isGitHubAppConfigured()
    ? buildAspInstallStateToken({ repositoryFullName, jobId })
    : undefined;

  let githubInstallationId: number | undefined;
  let status: AspJobRecord["status"] = "authorization_required";

  if (isGitHubAppConfigured()) {
    githubInstallationId = await findInstallationForRepository(
      value.repositoryOwner,
      value.repositoryName
    );
    if (githubInstallationId) {
      status = "queued";
    }
  }

  const now = durableNow();
  const job: AspJobRecord = {
    id: jobId,
    okxOrderId: value.okxOrderId,
    userId: value.userId,
    repositoryOwner: value.repositoryOwner,
    repositoryName: value.repositoryName,
    repositoryUrl: value.repositoryUrl,
    baseBranch: value.baseBranch,
    githubInstallationId,
    cleanupMode: value.cleanupMode,
    maximumChanges: value.maximumChanges,
    requiredChecks: value.requiredChecks,
    status,
    installStateToken,
    createdAt: now,
    updatedAt: now,
  };

  await saveAspJob(job);

  if (status === "queued") {
    const preflight = await runAspPreflight(job);
    if (preflight.baseCommit) {
      await updateAspJob(jobId, { baseCommitSha: preflight.baseCommit });
    }
  }

  const saved = (await getAspJob(jobId)) ?? job;
  return formatCreateResponse(saved);
}

function formatCreateResponse(job: AspJobRecord): AspJobCreateResponse {
  const response: AspJobCreateResponse = {
    jobId: job.id,
    status: job.status,
  };

  if (job.status === "authorization_required" && job.installStateToken) {
    response.githubInstallationUrl = buildAspGitHubInstallationUrl(job.installStateToken);
  }

  if (job.status === "failed") {
    response.failureCode = job.failureCode;
    response.failureMessage = job.failureMessage;
  }

  return response;
}

export async function getAspJobStatus(jobId: string) {
  const job = await getAspJob(jobId);
  if (!job) return undefined;

  const refreshed = await refreshAuthorizationIfNeeded(job);
  const githubInstallationUrl =
    refreshed.status === "authorization_required" && refreshed.installStateToken
      ? buildAspGitHubInstallationUrl(refreshed.installStateToken)
      : undefined;

  return buildAspJobStatusResponse(refreshed, githubInstallationUrl);
}

export async function runAspJobById(jobId: string) {
  let job = await getAspJob(jobId);
  if (!job) return undefined;

  if (job.status === "delivered") {
    return buildAspJobStatusResponse(job);
  }

  if (job.status === "failed") {
    return buildAspJobStatusResponse(job);
  }

  job = await refreshAuthorizationIfNeeded(job);

  if (job.status === "authorization_required") {
    return buildAspJobStatusResponse(
      job,
      job.installStateToken ? buildAspGitHubInstallationUrl(job.installStateToken) : undefined
    );
  }

  if (!["queued", "authorization_required"].includes(job.status)) {
    return buildAspJobStatusResponse(job);
  }

  await updateAspJob(job.id, { status: "queued" });
  const executed = await executeAspJob({ ...job, status: "queued" });
  return buildAspJobStatusResponse(executed);
}

export async function getAspJobDelivery(jobId: string) {
  const job = await getAspJob(jobId);
  if (!job) return undefined;
  return buildAspDeliveryResponse(job);
}

async function refreshAuthorizationIfNeeded(job: AspJobRecord): Promise<AspJobRecord> {
  if (job.status !== "authorization_required" || !isGitHubAppConfigured()) {
    return job;
  }

  const installationId = await findInstallationForRepository(
    job.repositoryOwner,
    job.repositoryName
  );

  if (!installationId) return job;

  const preflight = await runAspPreflight({ ...job, githubInstallationId: installationId, status: "queued" });
  if (preflight.repositoryAccess !== "confirmed") return job;

  const updated = await updateAspJob(job.id, {
    status: "queued",
    githubInstallationId: installationId,
    baseCommitSha: preflight.baseCommit ?? job.baseCommitSha,
    failureCode: undefined,
    failureMessage: undefined,
  });

  return updated ?? job;
}

export async function recordAspInstallBinding(input: {
  jobId: string;
  installationId: number;
  repositoryFullName: string;
}): Promise<void> {
  const job = await getAspJob(input.jobId);
  if (!job) return;

  const { saveAspRepositoryInstallation } = await import("./store");
  await saveAspRepositoryInstallation({
    installationId: input.installationId,
    repositoryFullName: input.repositoryFullName,
    authorizedAt: new Date().toISOString(),
  });

  await updateAspJob(input.jobId, {
    githubInstallationId: input.installationId,
    status: job.status === "authorization_required" ? "queued" : job.status,
  });
}
