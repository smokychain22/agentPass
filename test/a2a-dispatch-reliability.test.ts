/**
 * Regression coverage for A2A durable dispatch, deep-scan progress URL access,
 * acknowledgement copy, and fail-closed health semantics.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildAsyncTaskAcknowledgement } from "../src/lib/a2a/marketplace-intake";
import { mapA2AStatusToMarketplaceLifecycle } from "../src/lib/a2a/okx-marketplace-lifecycle";
import {
  DISPATCH_STARTUP_GRACE_MS,
  MAX_DISPATCH_ATTEMPTS,
  needsDispatchRecovery,
  readDispatchMeta,
} from "../src/lib/deep-scan/dispatch-queued-job";
import type { DeepScanJob } from "../src/lib/deep-scan/types";
import { setPersistentRecord } from "../src/lib/store/persistent-store";
import { GET as getDeepScan } from "../src/app/api/deep-scans/[id]/route";

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ ${name}`);
      throw err;
    }
  })();
}

function baseJob(id: string, patch?: Partial<DeepScanJob>): DeepScanJob {
  const t = new Date(Date.now() - 60_000).toISOString();
  return {
    id,
    status: "queued",
    stage: "QUEUED",
    progress: { stage: "QUEUED", percent: 0, updatedAt: t },
    request: {
      repoUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
      branch: "main",
      a2aTaskId: "task_test_dispatch_1",
      tenantId: "a2a:task_test_dispatch_1",
    },
    tenantId: "a2a:task_test_dispatch_1",
    attemptCount: 0,
    statusHistory: [{ stage: "QUEUED", at: t }],
    createdAt: t,
    updatedAt: t,
    workerMode: "github_actions_on_demand",
    ...patch,
  };
}

async function run() {
  console.log("a2a-dispatch-reliability");

  await test("shared dispatch helper exists and enforces attempt bounds", () => {
    const source = fs.readFileSync("src/lib/deep-scan/dispatch-queued-job.ts", "utf8");
    assert.match(source, /dispatchQueuedDeepScanJob/);
    assert.match(source, /DurableDispatchState/);
    assert.match(source, /FAILED_RETRYABLE/);
    assert.match(source, /correlateWorkflowRunForJob/);
    assert.equal(MAX_DISPATCH_ATTEMPTS >= 3, true);
    assert.equal(DISPATCH_STARTUP_GRACE_MS, 30_000);
  });

  await test("A2A orchestrator dispatches after createDeepScanJob", () => {
    const source = fs.readFileSync("src/lib/a2a/orchestrator.ts", "utf8");
    const createIdx = source.indexOf("createDeepScanJob");
    const dispatchIdx = source.indexOf("dispatchQueuedDeepScanJob");
    assert.ok(createIdx > 0 && dispatchIdx > createIdx);
  });

  await test("ack with repository does not ask for repository again", () => {
    const ack = buildAsyncTaskAcknowledgement({
      taskId: "task_abc",
      statusUrl: "https://example.test/api/a2a/tasks/task_abc",
      deepScanJobId: "deep_scan_abc",
      deepScanProgressUrl: "https://example.test/api/deep-scans/deep_scan_abc",
      hasRepository: true,
      requestedTaskType: "repository.safe_cleanup",
      currentPhase: "repository_analysis",
      dispatchState: "DISPATCHING",
    });
    assert.equal(ack.ok, true);
    assert.equal(ack.terminal, false);
    assert.equal(ack.marketplaceLifecycle, "ANALYSIS_QUEUED");
    assert.equal(ack.scanStarted, true);
    assert.equal(ack.requestedTaskType, "repository.safe_cleanup");
    assert.match(ack.message, /queued analysis/i);
    assert.doesNotMatch(ack.message, /Provide the repository URL/);
    assert.equal(ack.nextAction, "POLL_TASK_STATUS");
  });

  await test("lifecycle mapping does not claim waiting for repository when repo known", () => {
    assert.equal(
      mapA2AStatusToMarketplaceLifecycle("queued", { hasRepository: true }),
      "ANALYSIS_QUEUED"
    );
    assert.equal(
      mapA2AStatusToMarketplaceLifecycle("fetching_repository", { hasRepository: true }),
      "ANALYSIS_RUNNING"
    );
    assert.equal(
      mapA2AStatusToMarketplaceLifecycle("queued", { hasRepository: false }),
      "WAITING_FOR_REPOSITORY"
    );
  });

  await test("reviewer message with repository does not stay in discovery-only intake", async () => {
    const { resolveIntakeRepositoryUrl, isMarketplaceDiscoveryMessage } = await import(
      "../src/lib/a2a/marketplace-intake"
    );
    const message =
      "I would like to create a repository cleanup task using Agent ID 5283.\n\nRepository:\nhttps://github.com/velz-cmd/repodiet-e2e-test";
    assert.equal(isMarketplaceDiscoveryMessage(message), true);
    assert.equal(
      resolveIntakeRepositoryUrl({ message }),
      "https://github.com/velz-cmd/repodiet-e2e-test"
    );
    assert.equal(
      resolveIntakeRepositoryUrl({
        message: "I would like to create a repository cleanup task using Agent ID 5283.",
        repoUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
      }),
      "https://github.com/velz-cmd/repodiet-e2e-test"
    );
    assert.equal(
      resolveIntakeRepositoryUrl({
        message: "I would like to create a repository cleanup task using Agent ID 5283.",
      }),
      undefined
    );
  });

  await test("Preview worker callback URL does not use production NEXT_PUBLIC_APP_URL", async () => {
    const { publicApiBaseUrl } = await import("../src/lib/deep-scan/dispatch-queued-job");
    assert.equal(
      publicApiBaseUrl({
        VERCEL_ENV: "preview",
        VERCEL_URL: "skillswap-abc-skillswap7.vercel.app",
        NEXT_PUBLIC_APP_URL: "https://skillswap-virid-kappa.vercel.app",
      }),
      "https://skillswap-abc-skillswap7.vercel.app"
    );
    assert.equal(
      publicApiBaseUrl({
        VERCEL_ENV: "preview",
        VERCEL_BRANCH_URL: "skillswap-git-cursor-a2a-dispatch-reliability-8b2b-skillswap7.vercel.app",
        VERCEL_URL: "skillswap-abc-skillswap7.vercel.app",
        NEXT_PUBLIC_APP_URL: "https://skillswap-virid-kappa.vercel.app",
      }),
      "https://skillswap-git-cursor-a2a-dispatch-reliability-8b2b-skillswap7.vercel.app"
    );
  });

  await test("needsDispatchRecovery after grace for undispatched jobs", () => {
    const fresh = baseJob("deep_scan_fresh", {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    assert.equal(needsDispatchRecovery(fresh), false);

    const stale = baseJob("deep_scan_stale", {
      createdAt: new Date(Date.now() - 120_000).toISOString(),
      updatedAt: new Date(Date.now() - 120_000).toISOString(),
    });
    assert.equal(needsDispatchRecovery(stale), true);

    const withRun = baseJob("deep_scan_run", {
      workflowRunId: "12345",
      createdAt: new Date(Date.now() - 120_000).toISOString(),
    });
    assert.equal(needsDispatchRecovery(withRun), false);
  });

  await test("deep-scan progress URL is readable for A2A-bound jobs anonymously", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "";
    process.env.UPSTASH_REDIS_REST_TOKEN = "";
    const id = `deep_scan_progress_${Date.now()}`;
    const job = baseJob(id);
    await setPersistentRecord("deep_scan_jobs", id, job);
    const res = await getDeepScan(new Request("http://localhost/api/deep-scans/" + id), {
      params: Promise.resolve({ id }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      deepScanId: string;
      taskId: string;
      queueJobId: string;
      dispatchState: string;
    };
    assert.equal(body.ok, true);
    assert.equal(body.deepScanId, id);
    assert.equal(body.taskId, "task_test_dispatch_1");
    assert.equal(body.queueJobId, id);
    assert.ok(body.dispatchState);
  });

  await test("readDispatchMeta defaults to NOT_DISPATCHED", () => {
    const meta = readDispatchMeta(baseJob("x"));
    assert.equal(meta.dispatchState, "NOT_DISPATCHED");
    assert.equal(meta.dispatchAttempt, 0);
  });

  await test("health response keeps null heartbeat age instead of coercing to 0", () => {
    const source = fs.readFileSync("src/lib/okx/health.ts", "utf8");
    assert.match(source, /workerHeartbeatAgeSeconds: heartbeatAgeSeconds/);
    assert.doesNotMatch(source, /heartbeatAgeSeconds \?\? 0/);
    assert.match(source, /degradedReasons/);
    assert.match(source, /workerCapacityReady/);
    assert.match(source, /configurationReady/);
  });

  await test("task status route does not use success:false for nonterminal tasks", () => {
    const source = fs.readFileSync("src/app/api/a2a/tasks/[taskId]/route.ts", "utf8");
    assert.doesNotMatch(source, /success:\s*task\.status\s*===\s*"completed"/);
    assert.match(source, /formatted\.ok/);
  });

  console.log("a2a-dispatch-reliability: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
