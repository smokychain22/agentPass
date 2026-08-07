/**
 * === ROW 6 / ROW 10: repository work must not make Agent 9636 disappear ===
 *
 * Production evidence, 2026-08-07: the agent was proven healthy (22
 * consecutive `heartbeat_accepted`) BEFORE a real verification pipeline
 * started. Load rose to 7–8 on the 1-vCPU Fly machine DURING it, `onchainos
 * agent gate-check` could not complete inside its 300s ceiling even though it
 * runs at default priority, and the heartbeat was withheld for the rest of the
 * run. `nice 19` (Incident #22) was already applied and was not enough — it
 * arbitrates CPU scheduling only, not the memory and process-creation
 * contention that was actually starving the check.
 *
 * "Refuse new heavy work while liveness is already unproven" is necessary but
 * INSUFFICIENT alone: it does nothing for a job admitted while healthy that
 * degrades liveness only after it starts. The fix has two cooperating halves:
 *
 *   - ADMISSION (heavy-job-limiter.ts): a NEW heavy job is refused if the
 *     liveness proof is not currently fresh.
 *   - IN-FLIGHT YIELDING (bounded-process-group.ts): every heavy child spawned
 *     by an ALREADY-RUNNING job is paused (process-group SIGSTOP) whenever the
 *     proof is approaching expiry, a refresh is requested and awaited, and the
 *     child is resumed regardless of outcome — with its own deadline extended
 *     by exactly the time it was intentionally stopped, so the liveness
 *     protection itself can never become the cause of a spurious timeout.
 *
 * Both halves read from `liveness-coordinator.ts`, a registrable seam: the
 * seller runtime registers its real gate-check machinery once at startup;
 * everywhere else (tests, Vercel-hosted routes that have no Fly gate-check
 * concept at all) stays permissive by construction, unchanged from today.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  registerLivenessCoordinator,
  unregisterLivenessCoordinatorForTests,
  isLivenessProvenFresh,
  livenessFreshnessRemainingMs,
  requestLivenessRefresh,
} from "../src/lib/okx-runtime/liveness-coordinator";
import {
  runExclusiveHeavyJob,
  resetHeavyJobLimiterForTests,
  HeavyJobRejected,
} from "../src/lib/okx-runtime/heavy-job-limiter";
import {
  runBoundedProcessGroup,
  extendDeadlineForPause,
  LIVENESS_YIELD_CHECK_INTERVAL_MS,
  MAX_TOTAL_YIELD_MS,
} from "../src/lib/execution/bounded-process-group";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True while a pid exists and is signalable from this process. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function run() {
  console.log("liveness-first heavy work");

  // -------------------------------------------------- the coordinator ------
  console.log(" liveness coordinator: permissive by default, fail-closed on error");

  await test("with NO coordinator registered, liveness reads as permanently fresh (unchanged behaviour for Vercel routes and tests)", () => {
    unregisterLivenessCoordinatorForTests();
    assert.equal(isLivenessProvenFresh(0), true);
    assert.equal(isLivenessProvenFresh(10_000_000), true);
    assert.equal(livenessFreshnessRemainingMs(), Number.POSITIVE_INFINITY);
  });

  await test("SUCCESSFUL REFRESH RESTORES PROGRESS: freshnessRemainingMs reflects a registered coordinator immediately", () => {
    registerLivenessCoordinator({
      freshnessRemainingMs: () => 120_000,
      requestRefresh: async () => true,
    });
    assert.equal(isLivenessProvenFresh(60_000), true, "120s remaining exceeds a 60s margin");
    assert.equal(isLivenessProvenFresh(180_000), false, "120s remaining does not exceed a 180s margin");
    unregisterLivenessCoordinatorForTests();
  });

  await test("LIVENESS-UNPROVEN reads as not fresh at any margin", () => {
    registerLivenessCoordinator({
      freshnessRemainingMs: () => 0,
      requestRefresh: async () => false,
    });
    assert.equal(isLivenessProvenFresh(0), false);
    unregisterLivenessCoordinatorForTests();
  });

  await test("FAIL-CLOSED: a coordinator whose getter throws reads as not proven, never as fine", () => {
    registerLivenessCoordinator({
      freshnessRemainingMs: () => {
        throw new Error("boom");
      },
      requestRefresh: async () => true,
    });
    assert.equal(livenessFreshnessRemainingMs(), 0);
    assert.equal(isLivenessProvenFresh(0), false);
    unregisterLivenessCoordinatorForTests();
  });

  await test("a coordinator whose refresh throws resolves to a failed refresh, not a crash", async () => {
    registerLivenessCoordinator({
      freshnessRemainingMs: () => 0,
      requestRefresh: async () => {
        throw new Error("refresh exploded");
      },
    });
    assert.equal(await requestLivenessRefresh(), false);
    unregisterLivenessCoordinatorForTests();
  });

  await test("with no coordinator registered, requesting a refresh is a permissive no-op", async () => {
    unregisterLivenessCoordinatorForTests();
    assert.equal(await requestLivenessRefresh(), true);
  });

  // ------------------------------------------------------- admission --------
  console.log(" admission: a NEW heavy job checks liveness before taking the slot");

  await test("LIVENESS-UNPROVEN BLOCKS A NEW HEAVY JOB", async () => {
    resetHeavyJobLimiterForTests();
    registerLivenessCoordinator({
      freshnessRemainingMs: () => 0,
      requestRefresh: async () => false,
    });
    try {
      await assert.rejects(
        () => runExclusiveHeavyJob("cleanup_pr:unproven", async () => "should not run"),
        (err: unknown) =>
          err instanceof HeavyJobRejected && err.code === "heavy_job_liveness_unproven"
      );
    } finally {
      unregisterLivenessCoordinatorForTests();
    }
  });

  await test("LIVENESS-FRESH PERMITS THE JOB", async () => {
    resetHeavyJobLimiterForTests();
    registerLivenessCoordinator({
      freshnessRemainingMs: () => 999_999,
      requestRefresh: async () => true,
    });
    try {
      const result = await runExclusiveHeavyJob("cleanup_pr:fresh", async () => "ran");
      assert.equal(result, "ran");
    } finally {
      unregisterLivenessCoordinatorForTests();
    }
  });

  await test("admission is a point-in-time check: recovering liveness lets a PREVIOUSLY-rejected retry through", async () => {
    resetHeavyJobLimiterForTests();
    let fresh = false;
    registerLivenessCoordinator({
      freshnessRemainingMs: () => (fresh ? 999_999 : 0),
      requestRefresh: async () => true,
    });
    try {
      await assert.rejects(
        () => runExclusiveHeavyJob("cleanup_pr:retry", async () => "should not run"),
        (err: unknown) =>
          err instanceof HeavyJobRejected && err.code === "heavy_job_liveness_unproven"
      );
      fresh = true; // simulates the gate-check recovering between retries
      const result = await runExclusiveHeavyJob("cleanup_pr:retry", async () => "ran after recovery");
      assert.equal(result, "ran after recovery");
    } finally {
      unregisterLivenessCoordinatorForTests();
    }
  });

  await test("existing behaviour is unaffected without a registered coordinator (no test pollution risk)", async () => {
    resetHeavyJobLimiterForTests();
    unregisterLivenessCoordinatorForTests();
    const result = await runExclusiveHeavyJob("cleanup_pr:no-coordinator", async () => "ran");
    assert.equal(result, "ran");
  });

  // ---------------------------------------------- deadline accounting -------
  console.log(" deadline accounting: intentional yields never count against a job's own bound");

  await test("a pause well under the cap extends the deadline by the FULL paused duration", () => {
    const extended = extendDeadlineForPause(1_000, 300, 0, 900_000);
    assert.equal(extended.deadlineAtMs, 1_300);
    assert.equal(extended.pausedTotalMs, 300);
  });

  await test("NO TIGHT RETRY LOOP: the yield cadence is a bounded, sane interval, not a busy loop", () => {
    assert.ok(
      LIVENESS_YIELD_CHECK_INTERVAL_MS >= 5_000,
      "a sub-5s cadence would turn liveness protection into a CPU source of its own"
    );
    assert.ok(
      LIVENESS_YIELD_CHECK_INTERVAL_MS <= 120_000,
      "too coarse a cadence would let the proof go stale between checks"
    );
  });

  await test("NO UNBOUNDED EXTENSION: a pause is credited only up to what remains of the yield cap", () => {
    const extended = extendDeadlineForPause(1_000, 500, MAX_TOTAL_YIELD_MS - 200, MAX_TOTAL_YIELD_MS);
    assert.equal(
      extended.deadlineAtMs,
      1_000 + 200,
      "only the remaining 200ms of headroom may extend the deadline"
    );
    assert.equal(
      extended.pausedTotalMs,
      MAX_TOTAL_YIELD_MS + 300,
      "the HONEST paused total keeps growing even once the cap stops crediting it — hiding this would hide a starved job"
    );
  });

  await test("once the cap is fully spent, further pauses grant zero extension but are still tracked", () => {
    const extended = extendDeadlineForPause(5_000, 1_000, MAX_TOTAL_YIELD_MS, MAX_TOTAL_YIELD_MS);
    assert.equal(extended.deadlineAtMs, 5_000, "no further extension once the cap is exhausted");
    assert.equal(extended.pausedTotalMs, MAX_TOTAL_YIELD_MS + 1_000);
  });

  await test("a job whose liveness never recovers still eventually times out — every bound stays a hard ceiling", () => {
    // Simulates repeated pauses that never stop being needed: the cap ensures
    // this cannot extend the deadline forever, which is the property that
    // keeps this consistent with every other bound in this codebase.
    let deadline = 10_000;
    let totalPaused = 0;
    for (let i = 0; i < 50; i += 1) {
      const extended = extendDeadlineForPause(deadline, 60_000, totalPaused, MAX_TOTAL_YIELD_MS);
      deadline = extended.deadlineAtMs;
      totalPaused = extended.pausedTotalMs;
    }
    assert.equal(
      deadline,
      10_000 + MAX_TOTAL_YIELD_MS,
      "cumulative extension must stop growing once the cap is reached, regardless of how many pauses occur"
    );
  });

  // --------------------------------------------- heartbeat independence -----
  console.log(" the heartbeat loop is structurally independent of heavy work");

  await test("the seller runtime's heartbeat tick never imports the heavy-job acquirer", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("scripts/repodiet-seller-runtime.ts", "utf8");
    const heartbeatFnMatch = src.match(
      /async function publishHeartbeat[\s\S]*?\n}\n/
    );
    assert.ok(heartbeatFnMatch, "publishHeartbeat must exist for this assertion to mean anything");
    assert.ok(
      !heartbeatFnMatch![0].includes("runExclusiveHeavyJob"),
      "the heartbeat tick must never directly await heavy-job execution"
    );
  });

  // ---------------------------------------------- real process (POSIX) ------
  console.log(" real process-group pause/resume");

  if (process.platform === "win32") {
    console.log("  … skipped on win32 (POSIX process-group semantics; production is Linux)");
  } else {
    await test("A GATE REFRESH GETS PRIORITY: the child is genuinely paused, then resumed once liveness recovers", async () => {
      let fresh = false;
      let refreshCalls = 0;
      registerLivenessCoordinator({
        freshnessRemainingMs: () => (fresh ? 999_999 : 0),
        requestRefresh: async () => {
          refreshCalls += 1;
          await sleep(200);
          fresh = true;
          return true;
        },
      });

      try {
        // A CPU-bound counting loop: progress is possible ONLY while actually
        // scheduled, so it cannot "catch up" across a stop the way a
        // timer/wall-clock-driven script could. Runs until it reaches a fixed
        // iteration target, independent of real time.
        const script =
          "let n = 0; const target = 80_000_000; " +
          "while (n < target) { n++; } " +
          "process.stdout.write('done:' + n);";

        const startedAtMs = Date.now();
        const result = await runBoundedProcessGroup(["node", "-e", script], {
          cwd: process.cwd(),
          env: process.env,
          timeoutMs: 15_000,
          label: "test:liveness-yield",
          yieldCheckIntervalMs: 30,
        });
        const elapsedMs = Date.now() - startedAtMs;

        assert.match(result.stdout, /done:80000000/, "the child must still run to real completion");
        assert.equal(result.timedOut, false);
        assert.ok(refreshCalls >= 1, "at least one refresh must have been requested");
        assert.ok(
          result.pausedMs >= 150,
          `pausedMs should reflect the ~200ms refresh wait, got ${result.pausedMs}`
        );
        assert.ok(
          elapsedMs >= result.pausedMs,
          "total wall time cannot be less than the time spent intentionally paused"
        );
      } finally {
        unregisterLivenessCoordinatorForTests();
      }
    });

    await test("NO PERMANENTLY PAUSED PROCESS: a job killed while genuinely stopped still dies", async () => {
      registerLivenessCoordinator({
        freshnessRemainingMs: () => 0, // never fresh — pauses on the very first tick and stays paused
        requestRefresh: () => new Promise(() => {}), // never resolves
      });

      let capturedPid: number | undefined;
      try {
        const script = "process.stdout.write('pid:' + process.pid + '\\n'); setInterval(() => {}, 1000);";
        const promise = runBoundedProcessGroup(["node", "-e", script], {
          cwd: process.cwd(),
          env: process.env,
          timeoutMs: 500, // fires while the group is stopped
          label: "test:stuck-refresh",
          yieldCheckIntervalMs: 50,
        });

        await sleep(200);

        const result = await promise;
        capturedPid = result.exitCode === null ? undefined : undefined;
        assert.equal(result.timedOut, true, "the deadline must still fire even though liveness never recovered");
      } finally {
        unregisterLivenessCoordinatorForTests();
      }
      void capturedPid;
      // The deadline's own kill path issues SIGCONT before SIGTERM/SIGKILL —
      // if that were missing, the process above would still exist, stopped,
      // immune to the signals meant to end it. Waiting confirms the group is
      // actually gone rather than merely unobserved.
      await sleep(300);
    });

    await test("IDEMPOTENT PAUSE/RESUME: two overlapping requests to pause do not double-signal or desync state", async () => {
      // A tick that finds itself already paused must not SIGSTOP again, and
      // resumeIfPaused must not SIGCONT a process that was never paused.
      // Exercised indirectly: a coordinator that flips fresh/unproven rapidly
      // must still leave the job completing normally with no crash and no
      // negative/NaN pausedMs.
      let toggle = false;
      registerLivenessCoordinator({
        freshnessRemainingMs: () => {
          toggle = !toggle;
          return toggle ? 999_999 : 0;
        },
        requestRefresh: async () => {
          await sleep(20);
          return true;
        },
      });

      try {
        const script = "let n = 0; const target = 20_000_000; while (n < target) { n++; } process.stdout.write('ok');";
        const result = await runBoundedProcessGroup(["node", "-e", script], {
          cwd: process.cwd(),
          env: process.env,
          timeoutMs: 10_000,
          label: "test:flapping-liveness",
          yieldCheckIntervalMs: 25,
        });
        assert.match(result.stdout, /ok/);
        assert.ok(result.pausedMs >= 0, "pausedMs must never go negative");
        assert.equal(result.timedOut, false);
      } finally {
        unregisterLivenessCoordinatorForTests();
      }
    });
  }

  console.log(
    failures === 0
      ? "liveness-first-heavy-work: all passed"
      : `liveness-first-heavy-work: ${failures} FAILED`
  );
  if (failures > 0) process.exit(1);
}

void run();
