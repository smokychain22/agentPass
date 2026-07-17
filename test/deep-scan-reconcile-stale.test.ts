import assert from "node:assert/strict";
import {
  listDeepScanQueueIds,
  replaceDeepScanQueueIds,
  enqueueDeepScanAtomic,
  deepScanQueueDepth,
} from "../src/lib/deep-scan/atomic-queue";
import { setPersistentRecord, getPersistentRecord } from "../src/lib/store/persistent-store";
import type { DeepScanJob } from "../src/lib/deep-scan/types";
import { reconcileStaleDeepScanQueue } from "../src/lib/deep-scan/reconcile-stale";

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

function staleQueuedJob(id: string, hoursAgo: number): DeepScanJob {
  const created = new Date(Date.now() - hoursAgo * 3600_000).toISOString();
  return {
    id,
    status: "queued",
    stage: "QUEUED",
    progress: { stage: "QUEUED", percent: 0, updatedAt: created },
    request: {
      repoUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
      branch: "main",
      tenantId: "anonymous_public_readonly",
    },
    tenantId: "anonymous_public_readonly",
    repositoryOwner: "velz-cmd",
    repositoryName: "repodiet-e2e-test",
    repositoryFullName: "velz-cmd/repodiet-e2e-test",
    attemptCount: 0,
    statusHistory: [{ stage: "QUEUED", at: created, detail: "enqueued" }],
    createdAt: created,
    updatedAt: created,
    workerMode: "github_actions_on_demand",
  };
}

function readyJob(id: string): DeepScanJob {
  const t = new Date().toISOString();
  return {
    ...staleQueuedJob(id, 1),
    id,
    status: "complete",
    stage: "READY",
    scanId: "scan_keep_me",
    findingsId: "findings_keep_me",
    completedAt: t,
    updatedAt: t,
    progress: { stage: "READY", percent: 100, updatedAt: t },
    statusHistory: [
      { stage: "QUEUED", at: t },
      { stage: "READY", at: t, detail: "complete" },
    ],
  };
}

async function run() {
  console.log("deep-scan-reconcile-stale");

  await test("queue replace drops terminal ids without deleting records", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "";
    process.env.UPSTASH_REDIS_REST_TOKEN = "";
    const stale = staleQueuedJob("deep_scan_stale_test_1", 9);
    const keepReady = readyJob("deep_scan_ready_keep");
    await setPersistentRecord("deep_scan_jobs", stale.id, stale);
    await setPersistentRecord("deep_scan_jobs", keepReady.id, keepReady);
    await setPersistentRecord("deep_scan_jobs", "active:index", [stale.id, keepReady.id]);
    await replaceDeepScanQueueIds([stale.id, keepReady.id]);
    assert.equal(await deepScanQueueDepth(), 2);

    const report = await reconcileStaleDeepScanQueue({ apply: true });
    assert.ok(report.staleJobsReconciled >= 1);
    assert.equal(report.queueDepthAfter, 0);
    assert.equal(report.activeJobsAfter, 0);
    assert.equal(report.completedEvidencePreserved, true);

    const preserved = await getPersistentRecord<DeepScanJob>("deep_scan_jobs", keepReady.id);
    assert.equal(preserved?.stage, "READY");
    assert.equal(preserved?.scanId, "scan_keep_me");

    const transitioned = await getPersistentRecord<DeepScanJob>("deep_scan_jobs", stale.id);
    assert.equal(transitioned?.stage, "CANCELLED");
    assert.equal(transitioned?.failureCode, "SUPERSEDED_STALE_QUEUE");
    assert.ok((transitioned?.statusHistory?.length ?? 0) >= 2);

    const queue = await listDeepScanQueueIds();
    assert.deepEqual(queue, []);
  });

  await test("enqueue helper still works after replace", async () => {
    await enqueueDeepScanAtomic("deep_scan_fresh");
    assert.ok((await deepScanQueueDepth()) >= 1);
    await replaceDeepScanQueueIds([]);
    assert.equal(await deepScanQueueDepth(), 0);
  });

  console.log("deep-scan-reconcile-stale: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
