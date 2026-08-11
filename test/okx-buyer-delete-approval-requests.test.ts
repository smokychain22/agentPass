/**
 * Job 0xba4de4f576f0dbb05b0a88d2d889102dfb134f5e1c901bf0534312daf5d33402 has
 * 1 USDT escrowed and was stranded because RepoDiet's autonomous delivery
 * had no way to ask the buyer for approval when the only safe findings fell
 * outside OPERATOR_SAFE_DIRS — only a developer hand-editing
 * job-delivery-approvals.ts could unblock it. This store is the dynamic,
 * buyer-answerable counterpart: RepoDiet asks over A2A chat, the buyer
 * replies, and this file remembers exactly what was asked and answered.
 *
 * Runs against the REAL file store (write-then-rename to a temp
 * XDG_DATA_HOME), not a mock — this module IS the persistence, and
 * openclaw-plugins/repodiet-a2a-bridge/pending-delete-approvals.js reads
 * the exact same file from a separate process, so the on-disk contract is
 * what actually matters.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

/**
 * Every caller passes an ASYNC fn (most do `await import(...)` inside).
 * `finally` on a bare synchronous try/return does NOT wait for a returned
 * promise to settle — it runs immediately after `fn()` is merely CALLED, so
 * env restoration and the temp-dir deletion would fire before the async
 * body's post-await code ever runs, silently pointing every later
 * `storeDir()` call at the real $HOME instead of the isolated temp dir.
 * `Promise.resolve(fn()).finally(...)` genuinely waits for settlement first.
 */
function withIsolatedStore<T>(fn: () => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-buyer-approvals-"));
  const prev = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

async function run() {
  console.log("okx-buyer-delete-approval-requests");

  await test("createPendingDeleteApprovalRequest then getDeleteApprovalRequest round-trips through the real file store", async () => {
    await withIsolatedStore(async () => {
      const { createPendingDeleteApprovalRequest, getDeleteApprovalRequest } = await import(
        "../src/lib/okx-runtime/buyer-delete-approval-requests"
      );
      createPendingDeleteApprovalRequest({
        jobId: "0xJOB1",
        repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
        baseCommit: "abc123",
        requestedPaths: ["src/unused/empty-module.ts", "src/lib/orphan-a.ts"],
      });
      const found = getDeleteApprovalRequest("0xjob1");
      assert.ok(found, "jobId lookup must be case-insensitive, matching approvedDeletePathsForJob's own convention");
      assert.equal(found!.status, "pending");
      assert.deepEqual(found!.requestedPaths, ["src/unused/empty-module.ts", "src/lib/orphan-a.ts"]);
      assert.deepEqual(found!.approvedPaths, []);
    });
  });

  await test("getDeleteApprovalRequest returns undefined when no store file exists yet", async () => {
    await withIsolatedStore(async () => {
      const { getDeleteApprovalRequest } = await import("../src/lib/okx-runtime/buyer-delete-approval-requests");
      assert.equal(getDeleteApprovalRequest("0xnever-created"), undefined);
    });
  });

  await test("recordDeleteApprovalReply(approved) grants exactly the requested paths when none are narrowed", async () => {
    await withIsolatedStore(async () => {
      const {
        createPendingDeleteApprovalRequest,
        recordDeleteApprovalReply,
      } = await import("../src/lib/okx-runtime/buyer-delete-approval-requests");
      createPendingDeleteApprovalRequest({
        jobId: "0xjob2",
        repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
        baseCommit: "abc123",
        requestedPaths: ["src/unused/empty-module.ts"],
      });
      const updated = recordDeleteApprovalReply("0xjob2", { approved: true });
      assert.ok(updated);
      assert.equal(updated!.status, "approved");
      assert.deepEqual(updated!.approvedPaths, ["src/unused/empty-module.ts"]);
      assert.ok(updated!.respondedAt);
    });
  });

  await test("recordDeleteApprovalReply(declined) records the decline and grants nothing", async () => {
    await withIsolatedStore(async () => {
      const {
        createPendingDeleteApprovalRequest,
        recordDeleteApprovalReply,
      } = await import("../src/lib/okx-runtime/buyer-delete-approval-requests");
      createPendingDeleteApprovalRequest({
        jobId: "0xjob3",
        repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
        baseCommit: "abc123",
        requestedPaths: ["src/unused/empty-module.ts"],
      });
      const updated = recordDeleteApprovalReply("0xjob3", { approved: false });
      assert.ok(updated);
      assert.equal(updated!.status, "declined");
      assert.deepEqual(updated!.approvedPaths, []);
    });
  });

  await test("a partial approvedPaths reply can only narrow, never widen, what was actually requested", async () => {
    await withIsolatedStore(async () => {
      const {
        createPendingDeleteApprovalRequest,
        recordDeleteApprovalReply,
      } = await import("../src/lib/okx-runtime/buyer-delete-approval-requests");
      createPendingDeleteApprovalRequest({
        jobId: "0xjob4",
        repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
        baseCommit: "abc123",
        requestedPaths: ["src/unused/empty-module.ts", "src/lib/orphan-a.ts"],
      });
      const updated = recordDeleteApprovalReply("0xjob4", {
        approved: true,
        // Names one real requested path plus one NEVER requested — the
        // unrequested one must never appear in the grant.
        approvedPaths: ["src/unused/empty-module.ts", "package.json"],
      });
      assert.ok(updated);
      assert.deepEqual(updated!.approvedPaths, ["src/unused/empty-module.ts"]);
      assert.ok(!updated!.approvedPaths.includes("package.json"), "must never grant a path nobody requested deleting");
    });
  });

  await test("recordDeleteApprovalReply is a no-op for a job with no request at all", async () => {
    await withIsolatedStore(async () => {
      const { recordDeleteApprovalReply } = await import("../src/lib/okx-runtime/buyer-delete-approval-requests");
      assert.equal(recordDeleteApprovalReply("0xnever-asked", { approved: true }), undefined);
    });
  });

  await test("recordDeleteApprovalReply never double-records an already-answered request", async () => {
    await withIsolatedStore(async () => {
      const {
        createPendingDeleteApprovalRequest,
        recordDeleteApprovalReply,
        getDeleteApprovalRequest,
      } = await import("../src/lib/okx-runtime/buyer-delete-approval-requests");
      createPendingDeleteApprovalRequest({
        jobId: "0xjob5",
        repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
        baseCommit: "abc123",
        requestedPaths: ["src/unused/empty-module.ts"],
      });
      const first = recordDeleteApprovalReply("0xjob5", { approved: true });
      assert.equal(first!.status, "approved");
      const second = recordDeleteApprovalReply("0xjob5", { approved: false });
      assert.equal(second, undefined, "a second reply to an already-approved request must be rejected, not flip the outcome");
      assert.equal(getDeleteApprovalRequest("0xjob5")!.status, "approved", "the original approval must stand");
    });
  });

  await test("a new request for the same job REPLACES the old one — a moved base commit clears stale status", async () => {
    await withIsolatedStore(async () => {
      const {
        createPendingDeleteApprovalRequest,
        recordDeleteApprovalReply,
        getDeleteApprovalRequest,
      } = await import("../src/lib/okx-runtime/buyer-delete-approval-requests");
      createPendingDeleteApprovalRequest({
        jobId: "0xjob6",
        repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
        baseCommit: "commit-1",
        requestedPaths: ["src/unused/empty-module.ts"],
      });
      recordDeleteApprovalReply("0xjob6", { approved: true });
      assert.equal(getDeleteApprovalRequest("0xjob6")!.status, "approved");

      // Repository moved; a fresh delivery attempt asks again.
      createPendingDeleteApprovalRequest({
        jobId: "0xjob6",
        repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
        baseCommit: "commit-2",
        requestedPaths: ["src/lib/orphan-a.ts"],
      });
      const fresh = getDeleteApprovalRequest("0xjob6");
      assert.equal(fresh!.status, "pending", "a new base commit must not inherit the old approval");
      assert.equal(fresh!.baseCommit, "commit-2");
      assert.deepEqual(fresh!.requestedPaths, ["src/lib/orphan-a.ts"]);
    });
  });

  // --- Cross-process lock ---------------------------------------------------
  //
  // The seller-runtime (TS) process and the OpenClaw gateway (JS) process
  // both write this same shared file. A bare read-modify-write races a lost
  // update; every write now acquires an exclusive mkdir-EEXIST lock first
  // (mirroring action-ledger.ts's FileActionLedger.tryLock). These tests
  // exercise the lock itself, not just the happy path where it's always
  // free.

  await test("a lock genuinely held by a live process blocks a concurrent write — returns undefined, never corrupts the store", async () => {
    await withIsolatedStore(async () => {
      const dir = path.join(process.env.XDG_DATA_HOME!, "repodiet-a2a-bridge");
      const lock = path.join(dir, ".pending-delete-approvals.lock");
      fs.mkdirSync(dir, { recursive: true });
      fs.mkdirSync(lock);
      // Our OWN pid — guaranteed alive — simulates another live process
      // genuinely holding the lock right now.
      fs.writeFileSync(path.join(lock, "owner"), String(process.pid), "utf8");

      const { createPendingDeleteApprovalRequest, getDeleteApprovalRequest } = await import(
        "../src/lib/okx-runtime/buyer-delete-approval-requests"
      );
      const started = Date.now();
      const result = createPendingDeleteApprovalRequest({
        jobId: "0xlocked-job",
        repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
        baseCommit: "abc123",
        requestedPaths: ["src/unused/empty-module.ts"],
      });
      assert.equal(result, undefined, "must fail safe, not bypass the lock or corrupt the store");
      assert.ok(Date.now() - started >= 1900, "must actually wait out the acquisition timeout, not give up instantly");
      assert.equal(
        getDeleteApprovalRequest("0xlocked-job"),
        undefined,
        "the write must never have happened while the lock was held"
      );

      fs.rmSync(lock, { recursive: true, force: true });
    });
  });

  await test("a stale lock (dead owner PID) is reclaimed rather than blocking forever", async () => {
    await withIsolatedStore(async () => {
      const dir = path.join(process.env.XDG_DATA_HOME!, "repodiet-a2a-bridge");
      const lock = path.join(dir, ".pending-delete-approvals.lock");
      fs.mkdirSync(dir, { recursive: true });
      fs.mkdirSync(lock);
      // A PID overwhelmingly unlikely to be a live process on this machine.
      fs.writeFileSync(path.join(lock, "owner"), "999999999", "utf8");
      // Back-date the lock directory well past the staleness threshold.
      const old = new Date(Date.now() - 60_000);
      fs.utimesSync(lock, old, old);

      const { createPendingDeleteApprovalRequest, getDeleteApprovalRequest } = await import(
        "../src/lib/okx-runtime/buyer-delete-approval-requests"
      );
      const started = Date.now();
      const result = createPendingDeleteApprovalRequest({
        jobId: "0xstale-lock-job",
        repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
        baseCommit: "abc123",
        requestedPaths: ["src/unused/empty-module.ts"],
      });
      assert.ok(result, "a stale lock from a dead owner must be reclaimed, not treated as permanently held");
      assert.ok(Date.now() - started < 1000, "reclaiming a stale lock must not wait out the full acquisition timeout");
      assert.equal(getDeleteApprovalRequest("0xstale-lock-job")!.status, "pending");
    });
  });

  console.log("okx-buyer-delete-approval-requests: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
