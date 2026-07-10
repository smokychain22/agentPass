import { createJobId, saveJob, updateJob } from "./job-store";
import { durableNow } from "@/lib/store/durable-store";
import { runFindingsEngine } from "@/lib/findings/findings-engine";
import { storeFindings } from "@/lib/findings/findings-store";
import { isDemoRepoUrl } from "@/lib/demo/constants";
import type { FindingsJob, FindingsJobStage } from "./types";

export function createFindingsJob(
  repoUrl: string,
  branch: string | undefined,
  ownerKey: string
): FindingsJob {
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
  return saveJob(job) as FindingsJob;
}

export async function runFindingsJob(jobId: string): Promise<FindingsJob> {
  const job = updateJob(jobId, { status: "running", stage: "fetching_repo" }) as FindingsJob;

  try {
    const findings = await runFindingsEngine(job.repoUrl, job.branch, (stage: FindingsJobStage) => {
      updateJob(jobId, { status: "running", stage });
    });

    storeFindings(findings);

    return updateJob(jobId, {
      status: "complete",
      stage: "complete",
      result: findings,
      scanId: findings.scanId,
    }) as FindingsJob;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Findings analysis failed.";
    return updateJob(jobId, {
      status: "failed",
      stage: "complete",
      error: message,
    }) as FindingsJob;
  }
}
