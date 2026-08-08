/**
 * === Incident #29: "machine-wide" admission was only "process-wide" ===
 *
 * Discovered running the ROW 8 production PR proof on repodiet-agent-9636,
 * 2026-08-07: `scripts/verify-production-cleanup-pr.ts` runs as its own
 * standalone Node process, separate from the seller runtime. The single heavy
 * slot (`heavy-job-limiter.ts`'s in-memory `inFlight`) is module-level
 * memory — invisible across a process boundary. Both processes independently
 * believed they held "the machine's one heavy slot" and ran concurrently:
 *
 *   pid=1862 next build     (funded job, reparented to init)
 *   pid=2128 npm install    (funded job, patched phase)
 *   pid=2203 npm install    (the standalone proof script)
 *   LOAD=10.89   MemAvailable=231796 kB  (2015836 kB total, zero swap)
 *
 * These tests prove the fix at the level that actually matters: a REAL second
 * OS process, not a second in-process call, must be excluded.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  tryAcquireCrossProcessLock,
  touchCrossProcessLock,
  markCrossProcessLockDraining,
  releaseCrossProcessLock,
  setHeavyJobLockDirForTests,
} from "../src/lib/okx-runtime/heavy-job-cross-process-lock";
import {
  runExclusiveHeavyJob,
  resetHeavyJobLimiterForTests,
  HeavyJobRejected,
} from "../src/lib/okx-runtime/heavy-job-limiter";

let failures = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}`);
    console.error(err);
  }
}

function freshLockDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-heavy-lock-"));
  setHeavyJobLockDirForTests(dir);
  return dir;
}

async function run() {
  console.log("heavy-job cross-process lock");

  // ------------------------------------------------- basic acquisition -----
  console.log(" single-process acquire/release");

  await test("an uncontested lock is acquired", () => {
    freshLockDir();
    const result = tryAcquireCrossProcessLock("test:solo");
    assert.equal(result.ok, true);
    releaseCrossProcessLock();
  });

  await test("a second acquire by the SAME process is refused while the first is held", () => {
    freshLockDir();
    assert.equal(tryAcquireCrossProcessLock("test:first").ok, true);
    const second = tryAcquireCrossProcessLock("test:second");
    assert.equal(second.ok, false);
    releaseCrossProcessLock();
  });

  await test("after release, the lock is acquirable again", () => {
    freshLockDir();
    assert.equal(tryAcquireCrossProcessLock("test:a").ok, true);
    releaseCrossProcessLock();
    assert.equal(tryAcquireCrossProcessLock("test:b").ok, true);
    releaseCrossProcessLock();
  });

  await test("releasing a lock this process does not own is a no-op (never steals another holder's lock)", () => {
    const dir = freshLockDir();
    fs.writeFileSync(
      path.join(dir, "heavy-job.lock"),
      JSON.stringify({ label: "someone-else", pid: process.pid + 1, startedAtMs: Date.now(), updatedAtMs: Date.now(), draining: false })
    );
    releaseCrossProcessLock();
    assert.ok(fs.existsSync(path.join(dir, "heavy-job.lock")), "a lock owned by a different pid must survive our release call");
  });

  // ---------------------------------------------------------- staleness ----
  console.log(" staleness reclamation");

  await test("a lock whose owning pid no longer exists is treated as stale and reclaimed", () => {
    const dir = freshLockDir();
    // A pid essentially guaranteed not to exist on this host.
    const deadPid = 2 ** 30;
    fs.writeFileSync(
      path.join(dir, "heavy-job.lock"),
      JSON.stringify({ label: "crashed", pid: deadPid, startedAtMs: Date.now(), updatedAtMs: Date.now(), draining: false })
    );
    const result = tryAcquireCrossProcessLock("test:reclaim");
    assert.equal(result.ok, true, "a lock from a dead pid must be reclaimable immediately, not after 45 minutes");
    releaseCrossProcessLock();
  });

  await test("a lock owned by a LIVE pid that has not been touched recently is stale", () => {
    const dir = freshLockDir();
    fs.writeFileSync(
      path.join(dir, "heavy-job.lock"),
      JSON.stringify({
        label: "long-quiet",
        pid: process.pid, // genuinely alive (it's us), but...
        startedAtMs: Date.now() - 60 * 60_000,
        updatedAtMs: Date.now() - 50 * 60_000, // ...not touched in 50 minutes
        draining: false,
      })
    );
    const result = tryAcquireCrossProcessLock("test:reclaim-quiet");
    assert.equal(result.ok, true, "staleness is judged by last-touch, not by whether the pid happens to be alive");
    releaseCrossProcessLock();
  });

  await test("a lock touched recently is NOT stale, even if it has been held a long time", () => {
    const dir = freshLockDir();
    fs.writeFileSync(
      path.join(dir, "heavy-job.lock"),
      JSON.stringify({
        label: "long-but-healthy",
        pid: process.ppid, // a genuinely alive process, just not this one
        startedAtMs: Date.now() - 60 * 60_000,
        updatedAtMs: Date.now() - 1_000, // touched a second ago
        draining: false,
      })
    );
    const result = tryAcquireCrossProcessLock("test:blocked");
    assert.equal(result.ok, false, "a recently-touched lock must block regardless of total held duration");
  });

  await test("TOUCH keeps a long-running job's lock from going stale", () => {
    freshLockDir();
    assert.equal(tryAcquireCrossProcessLock("test:touched").ok, true);
    touchCrossProcessLock();
    const rival = tryAcquireCrossProcessLock("test:rival");
    assert.equal(rival.ok, false, "a freshly-touched lock must still be respected by another acquisition attempt");
    releaseCrossProcessLock();
  });

  await test("DRAINING is reflected to a rival's rejection reason", () => {
    freshLockDir();
    assert.equal(tryAcquireCrossProcessLock("test:drainer").ok, true);
    markCrossProcessLockDraining();
    const rival = tryAcquireCrossProcessLock("test:rival");
    assert.equal(rival.ok, false);
    assert.equal((rival as { draining?: boolean }).draining, true);
    releaseCrossProcessLock();
  });

  // --------------------------------------- runExclusiveHeavyJob composition -
  console.log(" runExclusiveHeavyJob acquires the cross-process lock too");

  await test("runExclusiveHeavyJob refuses when a DIFFERENT process (simulated via a manual lock write) holds the file lock, even though in-memory inFlight is clear", async () => {
    const dir = freshLockDir();
    resetHeavyJobLimiterForTests();
    fs.writeFileSync(
      path.join(dir, "heavy-job.lock"),
      JSON.stringify({ label: "other-process-job", pid: process.ppid, startedAtMs: Date.now(), updatedAtMs: Date.now(), draining: false })
    );
    await assert.rejects(
      () => runExclusiveHeavyJob("test:blocked-by-other-process", async () => "should not run"),
      (err: unknown) => err instanceof HeavyJobRejected && err.code === "heavy_job_already_running"
    );
  });

  await test("runExclusiveHeavyJob releases the cross-process lock when the job succeeds", async () => {
    freshLockDir();
    resetHeavyJobLimiterForTests();
    const result = await runExclusiveHeavyJob("test:releases-file-lock", async () => "ok");
    assert.equal(result, "ok");
    // The lock must be gone — a fresh direct acquisition must succeed.
    assert.equal(tryAcquireCrossProcessLock("test:after").ok, true);
    releaseCrossProcessLock();
  });

  await test("runExclusiveHeavyJob keeps the cross-process lock held (draining) past its own timeout", async () => {
    freshLockDir();
    resetHeavyJobLimiterForTests();
    let release: (() => void) | undefined;
    await assert.rejects(
      () =>
        runExclusiveHeavyJob(
          "test:drains-file-lock",
          () => new Promise<void>((resolve) => { release = resolve; }),
          { timeoutMs: 20 }
        ),
      (err: unknown) => err instanceof HeavyJobRejected && err.code === "heavy_job_timeout"
    );
    // The abandoned-but-still-running job's file lock must still be held.
    const rival = tryAcquireCrossProcessLock("test:rival-during-drain");
    assert.equal(rival.ok, false, "the file lock must stay held while the timed-out job's subprocess is still alive");
    release?.();
    await new Promise((r) => setTimeout(r, 20));
  });

  // -------------------------------------------- REAL second OS process -----
  console.log(" genuine cross-process exclusion (a real second Node process)");

  await test("A REAL SECOND PROCESS is excluded — this is the property Incident #29 actually broke", async () => {
    const dir = freshLockDir();
    const lockFile = path.join(dir, "heavy-job.lock");

    /**
     * A genuinely separate OS process, not an in-process call — an in-memory
     * `inFlight` check would already pass this, which is exactly why it did
     * not catch Incident #29. The child writes the lock file directly (the
     * same atomic `wx`-create the real module uses) rather than importing the
     * TS module, so this test has no build/transpile dependency on the child
     * and stays a pure filesystem-level proof.
     */
    const childScript = `
      const fs = require('fs');
      const path = require('path');
      const file = ${JSON.stringify(lockFile)};
      const fd = fs.openSync(file, 'wx');
      fs.writeFileSync(fd, JSON.stringify({
        label: 'external-process-job',
        pid: process.pid,
        startedAtMs: Date.now(),
        updatedAtMs: Date.now(),
        draining: false,
      }));
      fs.closeSync(fd);
      process.stdout.write('ACQUIRED\\n');
      // Stay alive so the pid liveness check reads this lock as genuinely held.
      setTimeout(() => {}, 4000);
    `;

    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, ["-e", childScript], { stdio: ["ignore", "pipe", "inherit"] });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("child never signalled ACQUIRED")), 3_000);
      child.stdout?.on("data", (chunk) => {
        if (String(chunk).includes("ACQUIRED")) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    // The PARENT test process — a real, different pid from the child —
    // must be refused by the SAME lock the child holds.
    const result = tryAcquireCrossProcessLock("parent-process-job");
    assert.equal(
      result.ok,
      false,
      "a lock held by a genuinely different OS process must block this process too"
    );
    assert.match(String((result as { reason: string }).reason), /external-process-job/);

    child.kill("SIGKILL");
    await new Promise((r) => setTimeout(r, 100));
  });

  await test("once the OTHER process's lock is released, this process can acquire it", async () => {
    const dir = freshLockDir();
    const lockFile = path.join(dir, "heavy-job.lock");
    const childScript = `
      const fs = require('fs');
      const file = ${JSON.stringify(lockFile)};
      const fd = fs.openSync(file, 'wx');
      fs.writeFileSync(fd, JSON.stringify({
        label: 'short-lived-external-job', pid: process.pid,
        startedAtMs: Date.now(), updatedAtMs: Date.now(), draining: false,
      }));
      fs.closeSync(fd);
      fs.unlinkSync(file); // releases immediately, simulating a job that finished
      process.stdout.write('DONE\\n');
    `;
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, ["-e", childScript], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("child never finished")), 3_000);
      child.stdout?.on("data", (chunk) => {
        if (String(chunk).includes("DONE")) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    await new Promise((r) => setTimeout(r, 50));
    const result = tryAcquireCrossProcessLock("test:after-external-release");
    assert.equal(result.ok, true, "the lock must be acquirable once the external process released it");
    releaseCrossProcessLock();
  });

  // ------------------------------------------- Incident #31: pid reuse -----
  console.log(" pid reuse across a restart (Incident #31)");

  if (process.platform === "win32") {
    console.log(
      "  … skipped on win32 (start-time disambiguation reads /proc, which does not exist here — production is Linux)"
    );
  } else {
    await test("a lock recorded for THIS pid but with a MISMATCHED start-time is stale, even though the pid is genuinely alive and the record is recently touched", () => {
      const dir = freshLockDir();
      // A wrong stand-in for the real start-time: the actual value is a real
      // process's boot-relative tick count, essentially never 1 on a machine
      // that has been up more than a moment.
      fs.writeFileSync(
        path.join(dir, "heavy-job.lock"),
        JSON.stringify({
          label: "stale-from-before-a-restart",
          pid: process.pid,
          pidStartTimeTicks: 1,
          startedAtMs: Date.now() - 5_000,
          updatedAtMs: Date.now(), // "just touched" — the old time-based check alone would call this fresh
          draining: false,
        })
      );
      const result = tryAcquireCrossProcessLock("test:reclaim-after-pid-reuse");
      assert.equal(
        result.ok,
        true,
        "a mismatched start-time must be treated as stale regardless of recency or pid-alive"
      );
      releaseCrossProcessLock();
    });

    await test("a lock recorded for THIS pid with the CORRECT start-time is NOT stale — no false positives from the new check", () => {
      const dir = freshLockDir();
      // Acquire for real once, so the file holds a genuine (pid, start-time)
      // pair for this actual process — then read it back as a rival would.
      assert.equal(tryAcquireCrossProcessLock("test:genuine-owner").ok, true);
      const genuine = JSON.parse(fs.readFileSync(path.join(dir, "heavy-job.lock"), "utf8"));
      releaseCrossProcessLock();

      fs.writeFileSync(path.join(dir, "heavy-job.lock"), JSON.stringify(genuine));
      const result = tryAcquireCrossProcessLock("test:should-be-blocked");
      assert.equal(
        result.ok,
        false,
        "a lock with a genuinely matching (pid, start-time) pair must still be respected"
      );
      releaseCrossProcessLock();
    });

    await test("a legacy record with NO pidStartTimeTicks field falls back to the plain pid-alive check (backward compatible)", () => {
      const dir = freshLockDir();
      fs.writeFileSync(
        path.join(dir, "heavy-job.lock"),
        JSON.stringify({
          label: "pre-incident-31-record",
          pid: process.pid, // no pidStartTimeTicks field at all
          startedAtMs: Date.now() - 5_000,
          updatedAtMs: Date.now(),
          draining: false,
        })
      );
      const result = tryAcquireCrossProcessLock("test:legacy-record");
      assert.equal(
        result.ok,
        false,
        "a legacy record for a genuinely alive pid must still block, exactly as before this fix"
      );
      releaseCrossProcessLock();
    });
  }

  console.log(
    failures === 0
      ? "heavy-job-cross-process-lock: all passed"
      : `heavy-job-cross-process-lock: ${failures} FAILED`
  );
  if (failures > 0) process.exit(1);
}

void run();
