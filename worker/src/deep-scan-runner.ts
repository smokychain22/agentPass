import type { DeepScanJob } from "../../src/lib/deep-scan/types";
import { postDeepScanProgress } from "./callback";

/**
 * Runs a claimed deep-scan job inside the worker process (not Vercel).
 * Claiming is exclusive to claim-next — this runner never re-claims.
 */
export async function runDeepScanJob(
  job: DeepScanJob,
  apiBase: string,
  apiKey: string,
  workerId: string
): Promise<void> {
  const log = (line: string) => console.log(`[deep-scan ${job.id}] ${line}`);
  const claimToken = job.claimToken;
  if (!claimToken) {
    throw new Error(`Deep-scan ${job.id} missing claimToken after claim-next`);
  }

  try {
    await postDeepScanProgress(apiBase, apiKey, job.id, {
      workerId,
      claimToken,
      stage: "INVENTORY",
      detail: "Worker claimed job — starting isolated inventory",
    });

    const { executeDeepScanJob } = await import("../../src/lib/deep-scan/execute");
    const completed = await executeDeepScanJob(job.id, workerId, {
      alreadyClaimed: true,
      claimToken,
    });
    if (!completed || completed.stage === "FAILED" || completed.stage === "FAILED_TERMINAL") {
      log(completed?.failureMessage ?? "Deep scan failed");
      return;
    }
    log(`READY scanId=${completed.scanId ?? "n/a"} graphId=${completed.graphId ?? "n/a"}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Deep scan worker execution failed";
    log(message);
    try {
      await postDeepScanProgress(apiBase, apiKey, job.id, {
        workerId,
        claimToken,
        stage: "FAILED_TERMINAL",
        detail: message,
        failureCode: "WORKER_EXECUTION_FAILED",
        failureMessage: message,
      });
    } catch (persistErr) {
      console.error("Failed to persist deep-scan failure", persistErr);
    }
  }
}
