import { createJobId, saveJob, updateJob } from "./job-store";
import { durableNow } from "@/lib/store/durable-store";
import { runPatchKitEngine } from "@/lib/patch-kit/patch-kit-engine";
import { validateCleanupPatch } from "@/lib/patch-kit/validate-patch";
import { isDemoRepoUrl } from "@/lib/demo/constants";
import type { FindingsPayload } from "@/lib/findings/types";
import type { PatchJob, PatchJobStage } from "./types";

export function createPatchJob(
  repoUrl: string,
  branch: string | undefined,
  ownerKey: string,
  findings?: FindingsPayload
): PatchJob {
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
  return saveJob(job) as PatchJob;
}

export async function runPatchJob(
  jobId: string,
  findings?: FindingsPayload
): Promise<PatchJob> {
  const job = updateJob(jobId, { status: "running", stage: "loading_findings" }) as PatchJob;

  const setStage = (stage: PatchJobStage) => {
    updateJob(jobId, { status: "running", stage });
  };

  try {
    setStage("classifying");
    setStage("generating_patch");

    const patchKit = await runPatchKitEngine({
      repoUrl: job.repoUrl,
      branch: job.branch,
      findings,
    });

    setStage("validating_patch");
    const validation = await validateCleanupPatch(
      job.repoUrl,
      job.branch,
      patchKit.artifacts.cleanupPatch
    );

    setStage("building_bundle");

    return updateJob(jobId, {
      status: "complete",
      stage: "complete",
      result: {
        ...patchKit,
        summary: {
          ...patchKit.summary,
        },
      },
      patchValidation: validation,
    }) as PatchJob;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Patch generation failed.";
    return updateJob(jobId, {
      status: "failed",
      stage: "complete",
      error: message,
    }) as PatchJob;
  }
}
