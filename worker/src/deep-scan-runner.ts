import type { DeepScanJob } from "../../src/lib/deep-scan/types";
import { postDeepScanProgress } from "./callback";

/**
 * Runs a claimed deep-scan job inside the worker process (not Vercel).
 * Progress is persisted through the API + shared durable store.
 */
export async function runDeepScanJob(
  job: DeepScanJob,
  apiBase: string,
  apiKey: string,
  workerId: string
): Promise<void> {
  const log = (line: string) => console.log(`[deep-scan ${job.id}] ${line}`);

  try {
    await postDeepScanProgress(apiBase, apiKey, job.id, {
      workerId,
      stage: "INVENTORY",
      detail: "Worker claimed job — starting isolated inventory",
    });

    // Execute using shared engine. Worker has Redis/Supabase credentials for durable writes
    // and must NOT expose GitHub App private keys / receipt signers to untrusted child builds.
    const { executeDeepScanJob } = await import("../../src/lib/deep-scan/execute");
    const completed = await executeDeepScanJob(job.id, workerId);
    if (!completed || completed.stage === "FAILED") {
      log(completed?.failureMessage ?? "Deep scan failed");
      return;
    }
    log(`READY scanId=${completed.scanId ?? "n/a"} graphId=${completed.graphId ?? "n/a"}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Deep scan worker execution failed";
    log(message);
    try {
      const { failDeepScanJob } = await import("../../src/lib/deep-scan/job-store");
      await failDeepScanJob(job.id, "WORKER_EXECUTION_FAILED", message);
    } catch (persistErr) {
      console.error("Failed to persist deep-scan failure", persistErr);
      await postDeepScanProgress(apiBase, apiKey, job.id, {
        workerId,
        stage: "FAILED",
        detail: message,
        failureCode: "WORKER_EXECUTION_FAILED",
        failureMessage: message,
      }).catch(() => {});
    }
  }
}
