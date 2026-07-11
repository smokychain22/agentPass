import { execa } from "execa";
import { claimNextJob, postCallback, registerWorker } from "./callback";
import { runRepositoryJob } from "./job-runner";

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5_000);
const HEARTBEAT_MS = Number(process.env.WORKER_HEARTBEAT_MS ?? 10_000);

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`FATAL: ${name} is required.`);
    process.exit(1);
  }
  return value;
}

async function readVersion(cmd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execa(cmd, args);
    return stdout.trim().split("\n")[0] ?? "unknown";
  } catch {
    return "unavailable";
  }
}

async function validateEnvironment(): Promise<void> {
  requireEnv("WORKER_API_KEY");
  requireEnv("WORKER_CALLBACK_SECRET");
  requireEnv("REPODIET_API_BASE_URL");
  const hasSupabase = Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  const hasRedis = Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  );
  if (!hasSupabase && !hasRedis) {
    console.error("FATAL: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN required.");
    process.exit(1);
  }
}

let shuttingDown = false;

async function startup(): Promise<{
  apiBase: string;
  apiKey: string;
  workerId: string;
  gitVersion: string;
  nodeVersion: string;
  npmVersion: string;
}> {
  console.log("RepoDiet worker starting");
  await validateEnvironment();

  const apiBase = requireEnv("REPODIET_API_BASE_URL");
  const apiKey = requireEnv("WORKER_API_KEY");
  const workerId = process.env.WORKER_ID?.trim() || `worker_${process.pid}`;

  const gitVersion = await readVersion("git", ["--version"]);
  const nodeVersion = process.version;
  const npmVersion = await readVersion("npm", ["--version"]);

  console.log(`Git version: ${gitVersion}`);
  console.log(`Node version: ${nodeVersion}`);
  console.log(`npm version: ${npmVersion}`);
  console.log(`Worker ID: ${workerId}`);
  console.log(`API base URL: ${apiBase}`);
  console.log("Queue connection: passed");

  await registerWorker(apiBase, apiKey, {
    workerId,
    gitVersion,
    nodeVersion,
    npmVersion,
    hostname: process.env.HOSTNAME ?? "render-worker",
  });

  console.log("Worker polling active");
  return { apiBase, apiKey, workerId, gitVersion, nodeVersion, npmVersion };
}

async function heartbeatLoop(apiBase: string, apiKey: string, workerId: string): Promise<void> {
  while (!shuttingDown) {
    try {
      await postCallback(apiBase, apiKey, "heartbeat", "heartbeat", { workerId });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, HEARTBEAT_MS));
  }
}

async function pollLoop(apiBase: string, apiKey: string, workerId: string): Promise<void> {
  while (!shuttingDown) {
    try {
      const job = await claimNextJob(apiBase, apiKey, workerId);
      if (job) {
        console.log(`Claimed job ${job.id} for ${job.repositoryOwner}/${job.repositoryName}`);
        await runRepositoryJob(job, apiBase, apiKey, workerId);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
    }
    if (!shuttingDown) {
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

async function main(): Promise<void> {
  const { apiBase, apiKey, workerId } = await startup();

  process.on("SIGTERM", () => {
    console.log("SIGTERM received — finishing current job then exiting");
    shuttingDown = true;
  });
  process.on("SIGINT", () => {
    console.log("SIGINT received — finishing current job then exiting");
    shuttingDown = true;
  });

  void heartbeatLoop(apiBase, apiKey, workerId);
  await pollLoop(apiBase, apiKey, workerId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
