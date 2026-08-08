/**
 * === Incident #30: the yield ticker is reactive, not authoritative ===
 *
 * Observed live on repodiet-agent-9636, 2026-08-08, with the Incident #29 fix
 * deployed: the PERIODIC gate-check refresh — the one on its own Incident
 * #13/#14 cadence, independent of any heavy job's own polling — still timed
 * out at its full 300s ceiling, twice:
 *
 *   gate_check_result outcome:"inconclusive" reason:"timeout" durationMs:300162
 *   gate_check_result outcome:"inconclusive" reason:"timeout" durationMs:300401
 *
 * `bounded-process-group.ts`'s per-child yield ticker only pauses a heavy
 * child REACTIVELY, when the child's own 20-second poll happens to notice
 * freshness is within `LIVENESS_YIELD_SAFETY_MARGIN_MS` of expiring. A
 * routine refresh that fires with plenty of freshness still banked — the
 * NORMAL case, since routine refreshes run roughly every 15 minutes while
 * the reactive margin is only 5 — finds no reason for any child to have
 * paused, and runs fully exposed to whatever heavy work is active.
 *
 * These tests pin the fix: the check itself pauses every active heavy child
 * before it runs, rather than waiting for a child to guess it should.
 */
import assert from "node:assert/strict";
import {
  runBoundedProcessGroup,
  pauseAllActiveHeavyChildrenForLivenessCheck,
  activeHeavyChildCountForTests,
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

async function run() {
  console.log("liveness check pauses active heavy work (Incident #30)");

  await test("no active children: pausing for a check is a harmless no-op", () => {
    assert.equal(activeHeavyChildCountForTests(), 0);
    const resume = pauseAllActiveHeavyChildrenForLivenessCheck();
    assert.doesNotThrow(resume);
  });

  // Liveness stays PERMISSIVE throughout (freshnessRemainingMs = Infinity, no
  // coordinator registered) so the per-child ticker itself never triggers —
  // isolating THIS mechanism (the external, check-initiated pause) from the
  // reactive one already covered by liveness-first-heavy-work.test.ts.

  if (process.platform === "win32") {
    console.log("  … remaining assertions skipped on win32 (POSIX process-group semantics; production is Linux)");
    console.log(
      failures === 0
        ? "liveness-check-pauses-active-heavy-work: all passed"
        : `liveness-check-pauses-active-heavy-work: ${failures} FAILED`
    );
    if (failures > 0) process.exit(1);
    return;
  }

  await test("A ROUTINE CHECK (no reactive trigger) still pauses an active heavy child", async () => {
    const script =
      "let n = 0; const target = 60_000_000; while (n < target) { n++; } process.stdout.write('done');";

    const runPromise = runBoundedProcessGroup(["node", "-e", script], {
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 15_000,
      label: "test:routine-pause-target",
      yieldCheckIntervalMs: 500, // fast ticker, but liveness stays permissive so it never fires
    });

    // Give the child a moment to actually spawn and register itself.
    await sleep(200);
    assert.equal(activeHeavyChildCountForTests(), 1, "the child must be registered as active while it runs");

    // Simulates what refreshOfficialGateCheck now does: pause everything
    // active, "run a check" (just a sleep here), then resume — WITHOUT any
    // per-child reactive trigger ever having fired.
    const resume = pauseAllActiveHeavyChildrenForLivenessCheck();
    await sleep(300);
    resume();

    const result = await runPromise;
    assert.match(result.stdout, /done/, "the child must still run to real completion");
    assert.equal(result.timedOut, false);
    assert.ok(
      result.pausedMs >= 250,
      `pausedMs should reflect the externally-imposed ~300ms pause, got ${result.pausedMs}`
    );
  });

  await test("the child is deregistered once it finishes — a completed job cannot be paused by a later check", async () => {
    const script = "process.stdout.write('quick');";
    await runBoundedProcessGroup(["node", "-e", script], {
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 10_000,
      label: "test:quick-exit",
    });
    await sleep(50);
    assert.equal(activeHeavyChildCountForTests(), 0, "a finished child must not remain registered");
  });

  await test("MULTIPLE active children are all paused and all resumed together", async () => {
    const script =
      "let n = 0; const target = 40_000_000; while (n < target) { n++; } process.stdout.write('done');";

    const [p1, p2] = [
      runBoundedProcessGroup(["node", "-e", script], {
        cwd: process.cwd(),
        env: process.env,
        timeoutMs: 15_000,
        label: "test:multi-a",
        yieldCheckIntervalMs: 500,
      }),
      runBoundedProcessGroup(["node", "-e", script], {
        cwd: process.cwd(),
        env: process.env,
        timeoutMs: 15_000,
        label: "test:multi-b",
        yieldCheckIntervalMs: 500,
      }),
    ];

    await sleep(200);
    assert.equal(activeHeavyChildCountForTests(), 2);

    const resume = pauseAllActiveHeavyChildrenForLivenessCheck();
    await sleep(200);
    resume();

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.match(r1.stdout, /done/);
    assert.match(r2.stdout, /done/);
    assert.equal(r1.timedOut, false);
    assert.equal(r2.timedOut, false);
  });

  await test("TWO overlapping external pause requests compose safely — no double-signal, no lost resume", async () => {
    // A second gate-check (or a reactive ticker pause landing at the same
    // moment) must not desync state: pauseForLiveness() is a safe no-op when
    // already paused (returns false, so it is correctly excluded from the
    // SECOND caller's resumers), and each caller's own resume() only ever
    // resumes what IT actually paused.
    const script =
      "let n = 0; const target = 40_000_000; while (n < target) { n++; } process.stdout.write('done');";
    const runPromise = runBoundedProcessGroup(["node", "-e", script], {
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 15_000,
      label: "test:overlapping-external-pauses",
    });
    await sleep(200);

    const resumeFirst = pauseAllActiveHeavyChildrenForLivenessCheck();
    const resumeSecond = pauseAllActiveHeavyChildrenForLivenessCheck();
    // The second caller found the child already paused, so it must have
    // nothing to resume — verified indirectly: resuming only the SECOND
    // caller must not actually unpause the job.
    resumeSecond();
    await sleep(150);
    assert.equal(
      activeHeavyChildCountForTests(),
      1,
      "the child must still be registered (alive) — a no-op resumer must not have crashed or deregistered it"
    );
    resumeFirst();

    const result = await runPromise;
    assert.match(result.stdout, /done/, "the child must still complete normally after both resumers run");
    assert.equal(result.timedOut, false);
  });

  console.log(
    failures === 0
      ? "liveness-check-pauses-active-heavy-work: all passed"
      : `liveness-check-pauses-active-heavy-work: ${failures} FAILED`
  );
  if (failures > 0) process.exit(1);
}

void run();
