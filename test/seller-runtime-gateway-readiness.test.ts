/**
 * Behavioral (not source-text) regression tests for
 * scripts/seller-runtime-supervisor.ts's `waitForGatewayReadyWithDeps` —
 * the dependency-injected core of the Gateway readiness gate.
 *
 * These exercise the REAL function against injected fakes for its two
 * dependencies (the Gateway child's stdout-milestone wait, and one
 * authenticated RPC probe attempt), so this is a true behavioral proof,
 * not a regex over the source text.
 */
import assert from "node:assert/strict";
import {
  waitForGatewayReadyWithDeps,
  observeGatewayStdoutChunk,
  resetGatewayStdoutReadyObservedForTests,
  isGatewayStdoutReadyObservedForTests,
  type GatewayReadinessDeps,
} from "../scripts/seller-runtime-supervisor";
import type { GatewayProbeResult } from "../src/lib/okx-runtime/gateway-rpc-probe";

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    await fn();
    console.log(`  ✓ ${name}`);
  })();
}

function failure(overrides: Partial<Extract<GatewayProbeResult, { ok: false }>> = {}): GatewayProbeResult {
  return {
    ok: false,
    category: "auth_failed",
    message: "fake failure",
    durationMs: 1,
    ...overrides,
  };
}

function success(): GatewayProbeResult {
  return {
    ok: true,
    serverVersion: "2026.7.1-2",
    connId: "fake-conn-id",
    authRole: "operator",
    authScopes: ["operator.admin"],
    durationMs: 1,
  };
}

async function run() {
  await test("observeGatewayStdoutChunk recognizes the real 'gateway ready' milestone, including when split across a larger log line", () => {
    resetGatewayStdoutReadyObservedForTests();
    assert.equal(isGatewayStdoutReadyObservedForTests(), false);
    observeGatewayStdoutChunk('{"level":"info","msg":"gateway ready"}\n');
    assert.equal(isGatewayStdoutReadyObservedForTests(), true);
  });

  await test("observeGatewayStdoutChunk ignores unrelated stdout chunks and only flips the flag on the real milestone text", () => {
    resetGatewayStdoutReadyObservedForTests();
    observeGatewayStdoutChunk("some unrelated startup log line\n");
    assert.equal(isGatewayStdoutReadyObservedForTests(), false);
    observeGatewayStdoutChunk("bootstrap_running: config schema unchanged\n");
    assert.equal(isGatewayStdoutReadyObservedForTests(), false);
    observeGatewayStdoutChunk("gateway ready\n");
    assert.equal(isGatewayStdoutReadyObservedForTests(), true);
  });

  await test("resetGatewayStdoutReadyObservedForTests genuinely resets state between scenarios, preventing cross-test leakage", () => {
    observeGatewayStdoutChunk("gateway ready\n");
    assert.equal(isGatewayStdoutReadyObservedForTests(), true);
    resetGatewayStdoutReadyObservedForTests();
    assert.equal(isGatewayStdoutReadyObservedForTests(), false);
  });

  await test("Incident #7 regression: a fake child-ready stdout milestone observed IMMEDIATELY cannot produce readiness while the authenticated RPC probe never succeeds — proves stdout alone is never sufficient", async () => {
    let probeAttempts = 0;
    const deps: GatewayReadinessDeps = {
      waitForStdoutReadyMarker: async () => "observed", // fake: stdout ready line seen instantly
      probeOnce: async () => {
        probeAttempts += 1;
        return failure({ category: "auth_failed", message: "gateway never actually authenticates in this scenario" });
      },
    };
    const ready = await waitForGatewayReadyWithDeps(deps, /* overallTimeoutMs */ 50, /* pollIntervalMs */ 10);
    assert.equal(ready, false, "readiness must be false when the RPC probe never succeeds, regardless of the stdout signal");
    assert.ok(probeAttempts >= 1, "the RPC probe must actually have been attempted, not skipped because stdout said ready");
  });

  await test("the stdout milestone timing out (never observed) does not block the RPC probe from being attempted — the probe is authoritative even without any stdout signal at all", async () => {
    let probeAttempts = 0;
    const deps: GatewayReadinessDeps = {
      waitForStdoutReadyMarker: async () => "timed_out", // fake: the conditional log line never printed
      probeOnce: async () => {
        probeAttempts += 1;
        return success();
      },
    };
    const ready = await waitForGatewayReadyWithDeps(deps, 1_000, 10);
    assert.equal(ready, true, "a successful RPC probe must produce readiness even if the preliminary stdout marker was never observed");
    assert.equal(probeAttempts, 1);
  });

  await test("a genuinely successful RPC probe, after the stdout marker was observed, produces readiness on the first attempt", async () => {
    let probeAttempts = 0;
    const deps: GatewayReadinessDeps = {
      waitForStdoutReadyMarker: async () => "observed",
      probeOnce: async () => {
        probeAttempts += 1;
        return success();
      },
    };
    const ready = await waitForGatewayReadyWithDeps(deps, 1_000, 10);
    assert.equal(ready, true);
    assert.equal(probeAttempts, 1);
  });

  await test("the RPC probe is retried until it succeeds, within the overall deadline", async () => {
    let probeAttempts = 0;
    const deps: GatewayReadinessDeps = {
      waitForStdoutReadyMarker: async () => "observed",
      probeOnce: async () => {
        probeAttempts += 1;
        return probeAttempts < 3 ? failure() : success();
      },
    };
    const ready = await waitForGatewayReadyWithDeps(deps, 1_000, 5);
    assert.equal(ready, true);
    assert.equal(probeAttempts, 3);
  });

  await test("the overall deadline is honored — the loop gives up and returns false rather than retrying forever", async () => {
    let probeAttempts = 0;
    const deps: GatewayReadinessDeps = {
      waitForStdoutReadyMarker: async () => "observed",
      probeOnce: async () => {
        probeAttempts += 1;
        return failure();
      },
    };
    const startedAt = Date.now();
    const ready = await waitForGatewayReadyWithDeps(deps, 100, 20);
    const elapsedMs = Date.now() - startedAt;
    assert.equal(ready, false);
    assert.ok(probeAttempts > 1, "must have retried at least once within the deadline");
    assert.ok(elapsedMs < 2_000, `must not run substantially past its own configured deadline (took ${elapsedMs}ms)`);
  });

  await test("the stdout wait itself is always awaited before the first probe attempt, in order", async () => {
    const order: string[] = [];
    const deps: GatewayReadinessDeps = {
      waitForStdoutReadyMarker: async () => {
        order.push("stdout_wait");
        return "observed";
      },
      probeOnce: async () => {
        order.push("probe");
        return success();
      },
    };
    await waitForGatewayReadyWithDeps(deps, 1_000, 10);
    assert.deepEqual(order, ["stdout_wait", "probe"]);
  });

  console.log("All seller-runtime-gateway-readiness tests passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
