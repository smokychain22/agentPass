import { claimNextJob } from "./callback";
import { runRepositoryJob } from "./job-runner";

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5_000);
const apiBase = process.env.REPODIET_API_BASE_URL?.trim() ?? "http://localhost:3000";
const apiKey = process.env.WORKER_API_KEY?.trim();
const workerId = process.env.WORKER_ID ?? `worker_${process.pid}`;

async function loop(): Promise<void> {
  if (!apiKey) {
    console.error("WORKER_API_KEY is required.");
    process.exit(1);
  }

  console.log(`RepoDiet worker ${workerId} polling ${apiBase}`);

  while (true) {
    try {
      const job = await claimNextJob(apiBase, apiKey, workerId);
      if (job) {
        console.log(`Claimed job ${job.id} for ${job.repositoryOwner}/${job.repositoryName}`);
        await runRepositoryJob(job, apiBase, apiKey);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

loop().catch((err) => {
  console.error(err);
  process.exit(1);
});
