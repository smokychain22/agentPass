import assert from "node:assert/strict";
import { reconcileParentTaskFromScan } from "../src/lib/a2a/reconcile-parent-from-scan";
import { saveA2ATask, buildInitialTask, getA2ATask } from "../src/lib/a2a/task-store";
import { setPersistentRecord } from "../src/lib/store/persistent-store";
import type { DeepScanJob } from "../src/lib/deep-scan/types";

/**
 * Regression for a production defect observed 2026-08-14 against
 * velz-cmd/repodiet-e2e-test (task_82774769615840 / deep_scan_ijCtzpAMUh92).
 *
 * The parent A2A task aborted at 09:23:49 with "The operation was aborted due
 * to timeout". Its own GitHub Actions worker then went READY at 09:24:44 — 55
 * seconds later — having validated 35 findings. Because `analysis_failed` is a
 * member of A2A_TERMINAL_STATUSES, `alreadyPastAnalysis()` treated the parent
 * as settled and reconciliation skipped it permanently: a completed analysis
 * stayed reported to the buyer as a failure.
 *
 * On a paid A2A task that is the worst shape of wrong — the work happened, the
 * customer was told it did not.
 */

const REPO = "https://github.com/velz-cmd/repodiet-e2e-test";

function test(name: string, fn: () => Promise<void>) {
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

function readyScan(id: string, a2aTaskId: string): DeepScanJob {
  const now = new Date().toISOString();
  return {
    id,
    status: "complete",
    stage: "READY",
    progress: { stage: "READY", percent: 100, updatedAt: now },
    request: { repoUrl: REPO, branch: "main", a2aTaskId },
    repositoryOwner: "velz-cmd",
    repositoryName: "repodiet-e2e-test",
    repositoryFullName: "velz-cmd/repodiet-e2e-test",
    attemptCount: 1,
    statusHistory: [{ stage: "READY", at: now }],
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    workerMode: "github_actions_on_demand",
    findingsId: `scan_${id}`,
  } as unknown as DeepScanJob;
}

function timedOutParent() {
  const task = buildInitialTask(
    "repository.safe_cleanup",
    { repoUrl: REPO, branch: "main" },
    { owner: "velz-cmd", name: "repodiet-e2e-test", branch: "main", url: REPO }
  );
  task.status = "analysis_failed";
  task.error = "The operation was aborted due to timeout";
  task.transitions.push({
    status: "analysis_failed",
    at: new Date().toISOString(),
    role: "repository_analyzer",
  });
  return task;
}

console.log("A2A timeout-race recovery");

async function main() {
  process.env.UPSTASH_REDIS_REST_URL = "";
  process.env.UPSTASH_REDIS_REST_TOKEN = "";

  await test("a parent that timed out is repaired when its own worker later reports READY", async () => {
    const task = timedOutParent();
    task.result = { deepScanJobId: "deep_scan_race_1", stateVersion: task.transitions.length };
    await saveA2ATask(task);

    const scan = readyScan("deep_scan_race_1", task.id);
    await setPersistentRecord("deep_scan_jobs", scan.id, scan);

    const result = await reconcileParentTaskFromScan(task.id, scan.id);
    assert.ok(result);
    assert.equal(result.advanced, true, `expected recovery, got reason=${result.reason}`);

    const fresh = await getA2ATask(task.id);
    assert.ok(fresh);
    assert.notEqual(fresh.status, "analysis_failed", "task must leave the failed state");
  });

  await test("the stale timeout error is cleared — a recovered task reports no failure reason", async () => {
    const task = timedOutParent();
    task.result = { deepScanJobId: "deep_scan_race_2", stateVersion: task.transitions.length };
    await saveA2ATask(task);

    const scan = readyScan("deep_scan_race_2", task.id);
    await setPersistentRecord("deep_scan_jobs", scan.id, scan);

    await reconcileParentTaskFromScan(task.id, scan.id);
    const fresh = await getA2ATask(task.id);
    assert.ok(fresh);
    assert.ok(!fresh.error, `recovered task still carries error: ${fresh.error}`);
  });

  await test("recovery is idempotent — a replayed callback does not advance twice", async () => {
    const task = timedOutParent();
    task.result = { deepScanJobId: "deep_scan_race_3", stateVersion: task.transitions.length };
    await saveA2ATask(task);

    const scan = readyScan("deep_scan_race_3", task.id);
    await setPersistentRecord("deep_scan_jobs", scan.id, scan);

    const first = await reconcileParentTaskFromScan(task.id, scan.id, { actor: "ingest_callback" });
    const second = await reconcileParentTaskFromScan(task.id, scan.id, { actor: "status_poll" });
    const third = await reconcileParentTaskFromScan(task.id, scan.id, { actor: "scheduled_job" });

    assert.ok(first && second && third);
    assert.equal(first.advanced, true);
    assert.equal(second.advanced, false, "second reconcile must not re-advance");
    assert.equal(third.advanced, false, "third reconcile must not re-advance");
  });

  await test("a settled task is NEVER rewritten by a late child — money has moved", async () => {
    // The carve-out must apply to analysis_failed only. completed /
    // escrow_released have paid out; a late READY child must not touch them.
    for (const settled of ["completed", "escrow_released"] as const) {
      const task = buildInitialTask(
        "repository.safe_cleanup",
        { repoUrl: REPO, branch: "main" },
        { owner: "velz-cmd", name: "repodiet-e2e-test", branch: "main", url: REPO }
      );
      task.status = settled;
      task.transitions.push({ status: settled, at: new Date().toISOString(), role: "orchestrator" });
      task.result = { deepScanJobId: `deep_scan_settled_${settled}`, stateVersion: task.transitions.length };
      await saveA2ATask(task);

      const scan = readyScan(`deep_scan_settled_${settled}`, task.id);
      await setPersistentRecord("deep_scan_jobs", scan.id, scan);

      const result = await reconcileParentTaskFromScan(task.id, scan.id);
      assert.ok(result);
      assert.equal(result.advanced, false, `${settled} must stay terminal`);

      const fresh = await getA2ATask(task.id);
      assert.equal(fresh?.status, settled, `${settled} status must be unchanged`);
    }
  });

  await test("a genuine analysis failure stays failed when the child also failed", async () => {
    const task = timedOutParent();
    task.result = { deepScanJobId: "deep_scan_realfail", stateVersion: task.transitions.length };
    await saveA2ATask(task);

    const now = new Date().toISOString();
    const failedScan = {
      id: "deep_scan_realfail",
      status: "failed",
      stage: "FAILED_TERMINAL",
      progress: { stage: "FAILED_TERMINAL", percent: 0, updatedAt: now },
      request: { repoUrl: REPO, branch: "main", a2aTaskId: task.id },
      repositoryOwner: "velz-cmd",
      repositoryName: "repodiet-e2e-test",
      repositoryFullName: "velz-cmd/repodiet-e2e-test",
      attemptCount: 1,
      statusHistory: [{ stage: "FAILED_TERMINAL", at: now }],
      createdAt: now,
      updatedAt: now,
      workerMode: "github_actions_on_demand",
      failureMessage: "worker crashed",
    } as unknown as DeepScanJob;
    await setPersistentRecord("deep_scan_jobs", failedScan.id, failedScan);

    await reconcileParentTaskFromScan(task.id, failedScan.id);
    const fresh = await getA2ATask(task.id);
    assert.equal(fresh?.status, "analysis_failed", "a real failure must remain failed");
  });

  console.log("A2A timeout-race recovery: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
