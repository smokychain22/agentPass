import assert from "node:assert/strict";
import { reconcileParentTaskFromScan } from "../src/lib/a2a/reconcile-parent-from-scan";
import { saveA2ATask, buildInitialTask, getA2ATask } from "../src/lib/a2a/task-store";
import { setPersistentRecord } from "../src/lib/store/persistent-store";
import type { DeepScanJob } from "../src/lib/deep-scan/types";

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

function readyScan(overrides: Partial<DeepScanJob> & { id: string }): DeepScanJob {
  const now = new Date().toISOString();
  return {
    status: "complete",
    stage: "READY",
    progress: { stage: "READY", percent: 100, updatedAt: now },
    request: { repoUrl: "https://github.com/velz-cmd/repodiet-e2e-test", branch: "main" },
    repositoryOwner: "velz-cmd",
    repositoryName: "repodiet-e2e-test",
    repositoryFullName: "velz-cmd/repodiet-e2e-test",
    attemptCount: 1,
    statusHistory: [{ stage: "READY", at: now }],
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    workerMode: "github_actions_on_demand",
    ...overrides,
  } as DeepScanJob;
}

console.log("A2A reconcile idempotency and correlation isolation");

async function main() {
  await test("a scan bound to a different A2A task is rejected, not cross-applied", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "";
    process.env.UPSTASH_REDIS_REST_TOKEN = "";

    const taskA = buildInitialTask(
      "repository.safe_cleanup",
      { repoUrl: "https://github.com/velz-cmd/repodiet-e2e-test", branch: "main" },
      { owner: "velz-cmd", name: "repodiet-e2e-test", branch: "main", url: "https://github.com/velz-cmd/repodiet-e2e-test" }
    );
    taskA.status = "fetching_repository";
    taskA.transitions.push({ status: "fetching_repository", at: new Date().toISOString(), role: "repository_analyzer" });
    taskA.result = { deepScanJobId: "deep_scan_owned_by_b", stateVersion: taskA.transitions.length };
    await saveA2ATask(taskA);

    const taskB = buildInitialTask(
      "repository.safe_cleanup",
      { repoUrl: "https://github.com/velz-cmd/repodiet-e2e-test", branch: "main" },
      { owner: "velz-cmd", name: "repodiet-e2e-test", branch: "main", url: "https://github.com/velz-cmd/repodiet-e2e-test" }
    );
    await saveA2ATask(taskB);

    // The scan explicitly belongs to taskB (correlation field set), but we try
    // to reconcile it against taskA — this must be rejected, not silently applied.
    const scan = readyScan({
      id: "deep_scan_owned_by_b",
      request: {
        repoUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
        branch: "main",
        a2aTaskId: taskB.id,
      },
    });
    await setPersistentRecord("deep_scan_jobs", scan.id, scan);

    const result = await reconcileParentTaskFromScan(taskA.id, scan.id);
    assert.ok(result);
    assert.equal(result!.advanced, false);
    assert.equal(result!.reason, "task_scan_correlation_mismatch");

    const reloadedA = await getA2ATask(taskA.id);
    assert.equal(reloadedA?.status, "fetching_repository", "task A must not be mutated by task B's scan");
  });

  await test("reconciling the same READY scan twice never emits a second analysis transition", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "";
    process.env.UPSTASH_REDIS_REST_TOKEN = "";

    const task = buildInitialTask(
      "repository.safe_cleanup",
      { repoUrl: "https://github.com/velz-cmd/repodiet-e2e-test", branch: "main" },
      { owner: "velz-cmd", name: "repodiet-e2e-test", branch: "main", url: "https://github.com/velz-cmd/repodiet-e2e-test" }
    );
    task.status = "fetching_repository";
    task.transitions.push({ status: "fetching_repository", at: new Date().toISOString(), role: "repository_analyzer" });
    task.result = { deepScanJobId: "deep_scan_dup_check", stateVersion: task.transitions.length };
    await saveA2ATask(task);

    const scan = readyScan({
      id: "deep_scan_dup_check",
      request: { repoUrl: "https://github.com/velz-cmd/repodiet-e2e-test", branch: "main", a2aTaskId: task.id },
    });
    await setPersistentRecord("deep_scan_jobs", scan.id, scan);

    await reconcileParentTaskFromScan(task.id, scan.id, { actor: "ingest_callback" });
    await reconcileParentTaskFromScan(task.id, scan.id, { actor: "status_poll" });
    await reconcileParentTaskFromScan(task.id, scan.id, { actor: "scheduled_job" });

    const final = await getA2ATask(task.id);
    assert.ok(final);
    const analyzingTransitions = final!.transitions.filter((t) => t.status === "analyzing");
    assert.ok(
      analyzingTransitions.length <= 1,
      `expected at most one "analyzing" transition, got ${analyzingTransitions.length}`
    );
  });

  console.log("A2A reconcile idempotency and correlation isolation: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
