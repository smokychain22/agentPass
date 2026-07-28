/**
 * Duplicate-task safety for A2A funding.
 *
 * Preflight previously returned `existingTask: null` with a comment saying
 * the official lookup had not landed. That is not safe: funding must never
 * proceed while it is unknown whether a paid task already covers the work.
 *
 * These tests pin the two halves of the contract — a real lookup, and a
 * failed lookup being treated as a blocker rather than an all-clear.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-active-task-"));
process.env.REPODIET_DATA_DIR = dataDir;

import { findActiveCleanupTask, claimTaskIdempotencyKey } from "../src/lib/a2a/find-active-task";
import { saveA2ATask, buildInitialTask } from "../src/lib/a2a/task-store";
import type { A2ATaskRecord } from "../src/lib/a2a/types";

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      throw err;
    });
}

const REPO = "velz-cmd/repodiet-e2e-test";
const COMMIT = "c0838e4cda326098a363b44e0e3ebe98e81e9463";

async function seedTask(overrides: Partial<A2ATaskRecord>) {
  const base = buildInitialTask(
    "repository.cleanup_pr",
    { repoUrl: `https://github.com/${REPO}`, branch: "main", commitSha: COMMIT },
    { owner: "velz-cmd", name: "repodiet-e2e-test", branch: "main", commitSha: COMMIT }
  );
  const task = { ...base, ...overrides } as A2ATaskRecord;
  await saveA2ATask(task);
  return task;
}

async function run() {
  console.log("a2a-active-task-lookup");

  const KEY = "idem_key_for_controlled_canary_0001";

  await test("reports a completed lookup with no match when nothing has claimed the key", async () => {
    const r = await findActiveCleanupTask({ idempotencyKey: KEY });
    assert.equal(r.lookupCompleted, true, "the search itself must succeed");
    assert.equal(r.found, false);
    assert.equal(r.method, "idempotency_record");
  });

  await test("claiming the key is atomic — a second claim for the same work fails", async () => {
    const task = await seedTask({ status: "funded" });
    const first = await claimTaskIdempotencyKey(KEY, task.id);
    assert.equal(first, true, "the first claim must succeed");
    const second = await claimTaskIdempotencyKey(KEY, "task_duplicate_attempt");
    assert.equal(second, false, "a duplicate claim must be refused");
  });

  await test("a claimed key with a live task blocks funding", async () => {
    const r = await findActiveCleanupTask({ idempotencyKey: KEY });
    assert.equal(r.lookupCompleted, true);
    assert.equal(r.found, true, "an active task must be detected");
    assert.equal(r.state, "funded");
    assert.equal(r.terminal, false);
  });

  await test("a different unit of work has its own key and is unaffected", async () => {
    const r = await findActiveCleanupTask({ idempotencyKey: "some_other_unit_of_work" });
    assert.equal(r.lookupCompleted, true);
    assert.equal(r.found, false);
  });

  await test("a terminal task no longer blocks new funding", async () => {
    const done = await seedTask({ status: "completed" });
    const key = "idem_terminal_case";
    await claimTaskIdempotencyKey(key, done.id);
    const r = await findActiveCleanupTask({ idempotencyKey: key });
    assert.equal(r.lookupCompleted, true);
    assert.equal(r.terminal, true);
    assert.equal(r.found, false, "completed work must not block new funding");
  });

  await test("a dangling claim is reported as UNKNOWN, never as an all-clear", async () => {
    // The claim exists but the task record does not. We cannot prove no paid
    // work happened, so this must block rather than pass.
    const key = "idem_dangling_claim";
    await claimTaskIdempotencyKey(key, "task_that_does_not_exist");
    const r = await findActiveCleanupTask({ idempotencyKey: key });
    assert.equal(r.lookupCompleted, false, "an unresolvable claim must not count as completed");
    assert.equal(r.found, false);
    assert.ok(r.lookupError, "an unknown state must carry a reason");
  });

  await test("the result distinguishes checked-and-clear from could-not-check", async () => {
    const clear = await findActiveCleanupTask({ idempotencyKey: "never_claimed_key" });
    const unknown = await findActiveCleanupTask({ idempotencyKey: "idem_dangling_claim" });
    assert.equal(clear.found, false);
    assert.equal(unknown.found, false);
    // Same `found`, different meaning — callers must key off lookupCompleted.
    assert.notEqual(clear.lookupCompleted, unknown.lookupCompleted);
  });

  console.log("a2a-active-task-lookup: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
