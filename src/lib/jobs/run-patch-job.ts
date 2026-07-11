import { createJobId, saveJob, updateJob } from "./job-store";
import { durableNow } from "@/lib/store/durable-store";
import { runPatchKitEngine } from "@/lib/patch-kit/patch-kit-engine";
import { isDemoRepoUrl } from "@/lib/demo/constants";
import type { FindingsPayload } from "@/lib/findings/types";
import type { PatchJob, PatchJobStage } from "./types";

export async function createPatchJob(
  repoUrl: string,
  branch: string | undefined,
  ownerKey: string,
  findings?: FindingsPayload
): Promise<PatchJob> {
  const job: PatchJob = {
    id: createJobId("patch"),
    type: "patch",
    status: "queued",
    stage: "queued",
    progress: null,
    ownerKey,
    repoUrl,
    branch,
    isDemo: isDemoRepoUrl(repoUrl),
    scanId: findings?.scanId,
    createdAt: durableNow(),
    updatedAt: durableNow(),
  };
  return (await saveJob(job)) as PatchJob;
}

export async function runPatchJob(
  jobId: string,
  findings?: FindingsPayload,
  selectedFindingIds?: string[]
): Promise<PatchJob> {
  const job = (await updateJob(jobId, { status: "running", stage: "loading_findings" })) as PatchJob;

  const setStage = (stage: PatchJobStage) => {
    void updateJob(jobId, { status: "running", stage });
  };

  try {
    setStage("classifying");
    setStage("generating_patch");

    const patchKit = await runPatchKitEngine({
      repoUrl: job.repoUrl,
      branch: job.branch,
      findings,
      selectedFindingIds,
    });

    setStage("validating_patch");
    setStage("building_bundle");

    return (await updateJob(jobId, {
      status: "complete",
      stage: "complete",
      result: patchKit,
      patchValidation: patchKit.patchValidation,
    })) as PatchJob;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Patch generation failed.";
    return (await updateJob(jobId, {
      status: "failed",
      stage: "complete",
      error: message,
    })) as PatchJob;
  }
}
