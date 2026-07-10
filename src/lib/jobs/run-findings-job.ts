import { createJobId, saveJob, updateJob } from "./job-store";
import { durableNow } from "@/lib/store/durable-store";
import { runFindingsEngine } from "@/lib/findings/findings-engine";
import { storeFindings } from "@/lib/findings/findings-store";
import { isDemoRepoUrl } from "@/lib/demo/constants";
import type { FindingsJob, FindingsJobStage } from "./types";

export async function createFindingsJob(
  repoUrl: string,
  branch: string | undefined,
  ownerKey: string
): Promise<FindingsJob> {
  const job: FindingsJob = {
    id: createJobId("findings"),
    type: "findings",
    status: "queued",
    stage: "queued",
    progress: null,
    ownerKey,
    repoUrl,
    branch,
    isDemo: isDemoRepoUrl(repoUrl),
    createdAt: durableNow(),
    updatedAt: durableNow(),
  };
  return (await saveJob(job)) as FindingsJob;
}

export async function runFindingsJob(jobId: string, scanId?: string): Promise<FindingsJob> {
  const job = (await updateJob(jobId, { status: "running", stage: "fetching_repo" })) as FindingsJob;

  try {
    const findings = await runFindingsEngine(
      job.repoUrl,
      job.branch,
      (stage: FindingsJobStage) => {
        void updateJob(jobId, { status: "running", stage });
      },
      { scanId }
    );

    await storeFindings(findings);

    return (await updateJob(jobId, {
      status: "complete",
      stage: "complete",
      result: findings,
      scanId: findings.scanId,
    })) as FindingsJob;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Findings analysis failed.";
    return (await updateJob(jobId, {
      status: "failed",
      stage: "complete",
      error: message,
    })) as FindingsJob;
  }
}
