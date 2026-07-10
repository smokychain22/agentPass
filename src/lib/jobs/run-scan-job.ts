import { createJobId, saveJob, updateJob } from "./job-store";
import { durableNow } from "@/lib/store/durable-store";
import { runBasicScan } from "@/lib/scanner/run-scan";
import { isDemoRepoUrl } from "@/lib/demo/constants";
import type { ScanJob, ScanJobStage } from "./types";

export async function runScanJob(
  jobId: string,
  repoUrl: string,
  branch: string | undefined,
  ownerKey: string
): Promise<ScanJob> {
  const isDemo = isDemoRepoUrl(repoUrl);

  const setStage = (stage: ScanJobStage) => {
    updateJob(jobId, { status: "running", stage });
  };

  try {
    setStage("fetching_repo");
    setStage("extracting");
    setStage("framework_detection");
    setStage("file_tree");

    const scan = await runBasicScan(repoUrl, branch);

    return updateJob(jobId, {
      status: "complete",
      stage: "complete",
      result: scan,
    }) as ScanJob;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed.";
    return updateJob(jobId, {
      status: "failed",
      stage: "complete",
      error: message,
    }) as ScanJob;
  }
}

export function createScanJob(
  repoUrl: string,
  branch: string | undefined,
  ownerKey: string
): ScanJob {
  const job: ScanJob = {
    id: createJobId("scan"),
    type: "scan",
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
  return saveJob(job) as ScanJob;
}
