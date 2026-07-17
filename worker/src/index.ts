import { execa } from "execa";
import {
  claimNextDeepScanJob,
  claimNextJob,
  postCallback,
  registerWorker,
} from "./callback";
import { runDeepScanJob } from "./deep-scan-runner";
import { runRepositoryJob } from "./job-runner";

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5_000);
const HEARTBEAT_MS = Number(process.env.WORKER_HEARTBEAT_MS ?? 10_000);
const WORKER_VERSION = process.env.WORKER_VERSION?.trim() || "2.0.0-deep-scan";

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
  const hasSupabase = Boolean(
    process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  );
  const hasRedis = Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  );
  if (!hasSupabase && !hasRedis) {
    console.error(
      "FATAL: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN required."
    );
    process.exit(1);
  }

  // First Meridian proof: fail closed for customer package scripts unless Docker isolation is COMPLETE.
  const sandboxMode = process.env.REPODIET_UNTRUSTED_SANDBOX?.trim() || "off";
  if (sandboxMode === "docker") {
    const { refreshSandboxClassification } = await import("../../src/lib/sandbox/untrusted-runner");
    const classification = await refreshSandboxClassification();
    if (classification !== "COMPLETE") {
      console.warn(
        "REPODIET_UNTRUSTED_SANDBOX=docker but Docker isolation is incomplete — forcing fail-closed (off)."
      );
      process.env.REPODIET_UNTRUSTED_SANDBOX = "off";
      delete process.env.REPODIET_DOCKER_SANDBOX;
    }
  } else {
    process.env.REPODIET_UNTRUSTED_SANDBOX = sandboxMode === "off" ? "off" : sandboxMode;
  }
  console.log(
    `Untrusted sandbox: ${process.env.REPODIET_UNTRUSTED_SANDBOX} (package scripts blocked unless COMPLETE)`
  );
}

let shuttingDown = false;
let currentJobId: string | undefined;

async function startup(): Promise<{
  apiBase: string;
  apiKey: string;
  workerId: string;
}> {
  console.log("RepoDiet worker starting");
  await validateEnvironment();

  const apiBase = requireEnv("REPODIET_API_BASE_URL");
  const apiKey = requireEnv("WORKER_API_KEY");
  const workerId = process.env.WORKER_ID?.trim() || `worker_${process.pid}`;
  const workerHost =
    process.env.WORKER_HOST?.trim() || process.env.HOSTNAME?.trim() || "production-worker";

  const gitVersion = await readVersion("git", ["--version"]);
  const nodeVersion = process.version;
  const npmVersion = await readVersion("npm", ["--version"]);

  console.log(`Worker version: ${WORKER_VERSION}`);
  console.log(`Git version: ${gitVersion}`);
  console.log(`Node version: ${nodeVersion}`);
  console.log(`npm version: ${npmVersion}`);
  console.log(`Worker ID: ${workerId}`);
  console.log(`Worker host: ${workerHost}`);
  console.log(`API base URL: ${apiBase}`);
  console.log("Queue connection: passed");
  console.log("Job types: deep_scan (read-only findings) + repository_cleanup");
  console.log(
    "Safety: read-only findings allow archive/inventory/graph/analyzers; npm install/build/test/lint/package scripts are blocked until Docker sandbox is COMPLETE."
  );

  await registerWorker(apiBase, apiKey, {
    workerId,
    gitVersion,
    nodeVersion,
    npmVersion,
    hostname: workerHost,
  });

  console.log("Worker polling active");
  return { apiBase, apiKey, workerId };
}

async function heartbeatLoop(apiBase: string, apiKey: string, workerId: string): Promise<void> {
  while (!shuttingDown) {
    try {
      await postCallback(apiBase, apiKey, "heartbeat", "heartbeat", {
        workerId,
        status: currentJobId ? "busy" : "online",
        currentJobId,
        version: WORKER_VERSION,
      });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, HEARTBEAT_MS));
  }
}

async function pollLoop(apiBase: string, apiKey: string, workerId: string): Promise<void> {
  while (!shuttingDown) {
    try {
      // Prefer deep-scan queue (read-only analysis) then cleanup repository jobs.
      const deepScan = await claimNextDeepScanJob(apiBase, apiKey, workerId);
      if (deepScan) {
        currentJobId = deepScan.id;
        console.log(
          `Claimed deep-scan ${deepScan.id} for ${deepScan.request.repoUrl} (tenant=${deepScan.tenantId ?? "n/a"})`
        );
        await runDeepScanJob(deepScan, apiBase, apiKey, workerId);
        currentJobId = undefined;
      } else {
        const job = await claimNextJob(apiBase, apiKey, workerId);
        if (job) {
          currentJobId = job.id;
          console.log(`Claimed cleanup job ${job.id} for ${job.repositoryOwner}/${job.repositoryName}`);
          await runRepositoryJob(job, apiBase, apiKey, workerId);
          currentJobId = undefined;
        }
      }
    } catch (err) {
      currentJobId = undefined;
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
