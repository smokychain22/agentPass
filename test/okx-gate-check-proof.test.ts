/**
 * Incident #15 regression battery.
 *
 * Reproduced live on repodiet-agent-9636: three consecutive `onchainos agent
 * gate-check` runs hit the 150s bound at the 900s cadence — exactly the
 * 2,700s freshness window — so the cached proof expired and the marketplace
 * heartbeat was withheld for ~10 minutes while the daemon and XMTP client
 * were continuously healthy.
 *
 * These tests pin BOTH directions of the fix: an inconclusive timeout must
 * not cost availability, and a confirmed failure must not be survivable.
 */
import assert from "node:assert/strict";
import {
  classifyGateCheckOutcome,
  DEFAULT_GATE_CHECK_LIMITS,
  GateProofState,
  type GateCheckLimits,
} from "../src/lib/okx-runtime/gate-check-proof";

function test(name: string, fn: () => Promise<void> | void) {
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

const AGENT = "9636";
const LIMITS: GateCheckLimits = DEFAULT_GATE_CHECK_LIMITS;

function readyStdout(overrides: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    ok: true,
    data: {
      ready: true,
      identity: { agentId: AGENT },
      communication: { ok: true },
      wallet: { ok: true },
      ...overrides,
    },
  })}`;
}

function classify(input: Partial<Parameters<typeof classifyGateCheckOutcome>[0]>) {
  return classifyGateCheckOutcome({
    durationMs: 1_000,
    expectedAgentId: AGENT,
    timeoutMs: LIMITS.timeoutMs,
    ...input,
  });
}

async function run() {
  console.log("okx-gate-check-proof");

  // --- classification ------------------------------------------------------

  await test("a clean, ready gate-check is classified as passed", () => {
    assert.equal(classify({ stdout: readyStdout() }).kind, "passed");
  });

  await test("a SLOW but successful gate-check still passes — duration alone is not failure", () => {
    // 149s: nearly at the bound, but it answered. This is the case the old
    // code got right and must not regress.
    const outcome = classify({ stdout: readyStdout(), durationMs: 149_000 });
    assert.equal(outcome.kind, "passed");
    assert.equal(outcome.durationMs, 149_000);
  });

  await test("a TIMED-OUT refresh is inconclusive, never a failure", () => {
    // Every spelling a runner may use for a kill at the bound.
    for (const error of [
      { killed: true, signal: "SIGTERM", message: "timeout" },
      { code: "ETIMEDOUT", message: "etimedout" },
      { signal: "SIGKILL", message: "killed" },
    ]) {
      const outcome = classify({ error, durationMs: 150_010 });
      assert.equal(outcome.kind, "inconclusive", `${JSON.stringify(error)} must be inconclusive`);
      assert.equal(outcome.reason, "timeout");
    }
  });

  await test("unparseable output is inconclusive — an unreadable answer is not a 'no'", () => {
    assert.equal(classify({ stdout: "not json at all" }).kind, "inconclusive");
    assert.equal(classify({ stdout: "" }).kind, "inconclusive");
    assert.equal(classify({ stdout: '{"ok":true}' }).kind, "inconclusive");
  });

  await test("a CONFIRMED not-ready gate is a failure, and names what failed", () => {
    const outcome = classify({ stdout: readyStdout({ wallet: { ok: false } }) });
    assert.equal(outcome.kind, "failed");
    assert.match(outcome.kind === "failed" ? outcome.reason : "", /wallet/);

    const comms = classify({ stdout: readyStdout({ communication: { ok: false } }) });
    assert.equal(comms.kind, "failed");
    assert.match(comms.kind === "failed" ? comms.reason : "", /communication/);
  });

  await test("a gate-check answering for the WRONG agent is a confirmed identity failure", () => {
    // Must never be softened into "inconclusive" — a wrong identity is the
    // one thing that must never be concealed.
    const outcome = classify({ stdout: readyStdout({ identity: { agentId: "5283" } }) });
    assert.equal(outcome.kind, "failed");
    assert.match(outcome.kind === "failed" ? outcome.reason : "", /identity_mismatch:5283/);
  });

  // --- proof lifetime ------------------------------------------------------

  await test("a VALID cached proof lets the runtime claim online", () => {
    const state = new GateProofState(LIMITS);
    const t0 = 1_000_000;
    state.record({ kind: "passed", durationMs: 20_000 }, t0);
    assert.equal(state.mayClaimOnline(t0 + 60_000), true);
    assert.equal(state.health(t0 + 60_000), "proven");
    assert.equal(state.reason(t0 + 60_000), undefined);
  });

  await test("an EXPIRED cached proof fails closed — no online claim", () => {
    const state = new GateProofState(LIMITS);
    const t0 = 1_000_000;
    state.record({ kind: "passed", durationMs: 20_000 }, t0);
    const expired = t0 + LIMITS.freshnessMs + 1;
    assert.equal(state.mayClaimOnline(expired), false);
    assert.equal(state.health(expired), "unproven");
    assert.equal(state.reason(expired), "proof_expired");
  });

  await test("with no proof at all the runtime never claims online", () => {
    const state = new GateProofState(LIMITS);
    assert.equal(state.mayClaimOnline(1_000_000), false);
    assert.equal(state.reason(1_000_000), "no_proof_yet");
  });

  await test("an inconclusive timeout PRESERVES a still-valid proof (the Incident #15 fix)", () => {
    const state = new GateProofState(LIMITS);
    const t0 = 1_000_000;
    state.record({ kind: "passed", durationMs: 20_000 }, t0);
    state.record({ kind: "inconclusive", durationMs: 150_010, reason: "timeout" }, t0 + 900_000);
    assert.equal(state.mayClaimOnline(t0 + 900_000), true, "a timeout must not cost availability");
    assert.equal(state.health(t0 + 900_000), "degraded_unconfirmed", "but it must be reported honestly");
  });

  await test("a CONFIRMED failure invalidates the proof IMMEDIATELY, not when it ages out", () => {
    // The under-honest half of Incident #15: the old code left a fresh proof
    // standing for up to 45 more minutes after the gate said it was broken.
    const state = new GateProofState(LIMITS);
    const t0 = 1_000_000;
    state.record({ kind: "passed", durationMs: 20_000 }, t0);
    assert.equal(state.mayClaimOnline(t0 + 1_000), true);

    state.record({ kind: "failed", durationMs: 5_000, reason: "gate_not_ready:wallet" }, t0 + 2_000);
    assert.equal(
      state.mayClaimOnline(t0 + 2_001),
      false,
      "a contradicted proof must die at once — never survive on freshness"
    );
    assert.equal(state.health(t0 + 2_001), "unproven");
    assert.equal(state.reason(t0 + 2_001), "gate_not_ready:wallet");
  });

  await test("RECOVERY after a timeout restores a full online claim and clears backoff", () => {
    const state = new GateProofState(LIMITS);
    const t0 = 1_000_000;
    state.record({ kind: "passed", durationMs: 20_000 }, t0);
    state.record({ kind: "inconclusive", durationMs: 150_010, reason: "timeout" }, t0 + 900_000);
    state.record({ kind: "inconclusive", durationMs: 150_010, reason: "timeout" }, t0 + 960_000);
    assert.equal(state.health(t0 + 960_000), "degraded_unconfirmed");

    state.record({ kind: "passed", durationMs: 18_000 }, t0 + 1_020_000);
    assert.equal(state.mayClaimOnline(t0 + 1_020_000), true);
    assert.equal(state.health(t0 + 1_020_000), "proven");
    // Clock passed explicitly: as of Incident #20 the cadence also depends on
    // how much life the CURRENT proof has left, so reading the real wall clock
    // here would compare a synthetic proof against today's date and always see
    // it as expired. The property under test is unchanged — after a pass, the
    // outcome-derived delay returns to the normal slow cadence.
    assert.equal(
      state.nextRefreshDelayMs(t0 + 1_020_000),
      LIMITS.refreshMs,
      "backoff must reset after recovery"
    );
  });

  await test("recovery after a CONFIRMED failure also clears the failure state", () => {
    const state = new GateProofState(LIMITS);
    const t0 = 1_000_000;
    state.record({ kind: "failed", durationMs: 5_000, reason: "gate_not_ready:wallet" }, t0);
    assert.equal(state.mayClaimOnline(t0 + 1), false);
    state.record({ kind: "passed", durationMs: 20_000 }, t0 + 60_000);
    assert.equal(state.mayClaimOnline(t0 + 60_001), true);
    assert.equal(state.reason(t0 + 60_001), undefined);
  });

  // --- retry cadence -------------------------------------------------------

  await test("inconclusive results back off from a SHORT base, bounded, never exceeding a normal refresh", () => {
    const state = new GateProofState(LIMITS);
    assert.equal(state.nextRefreshDelayMs(), LIMITS.refreshMs, "healthy cadence is the slow one");

    const seen: number[] = [];
    for (let i = 0; i < 8; i++) {
      state.record({ kind: "inconclusive", durationMs: 150_010, reason: "timeout" }, 1_000 + i);
      seen.push(state.nextRefreshDelayMs());
    }
    assert.deepEqual(seen.slice(0, 4), [60_000, 120_000, 240_000, 480_000]);
    for (const delay of seen) {
      assert.ok(delay <= LIMITS.backoffMaxMs, `${delay} must be capped`);
      assert.ok(delay <= LIMITS.refreshMs, `${delay} must never exceed the normal refresh`);
      assert.ok(delay > 0);
    }
  });

  await test("the retry schedule gives many more attempts inside one freshness window than before", () => {
    // The concrete arithmetic that caused the outage: at a flat 900s cadence,
    // the 2,700s window allows only 3 attempts, and 3 timeouts lose the proof.
    assert.equal(Math.floor(LIMITS.freshnessMs / LIMITS.refreshMs), 3);

    const state = new GateProofState(LIMITS);
    let elapsed = 0;
    let attempts = 0;
    while (elapsed < LIMITS.freshnessMs) {
      state.record({ kind: "inconclusive", durationMs: 150_010, reason: "timeout" }, elapsed);
      elapsed += state.nextRefreshDelayMs();
      attempts++;
    }
    assert.ok(
      attempts >= 6,
      `expected substantially more than 3 attempts inside the freshness window, got ${attempts}`
    );
  });

  // --- restore -------------------------------------------------------------

  await test("a persisted proof is restored only while genuinely still fresh", () => {
    const now = 5_000_000;
    const fresh = new GateProofState(LIMITS);
    assert.equal(fresh.restore(now - 60_000, now), true);
    assert.equal(fresh.mayClaimOnline(now), true);

    const stale = new GateProofState(LIMITS);
    assert.equal(stale.restore(now - LIMITS.freshnessMs - 1, now), false);
    assert.equal(stale.mayClaimOnline(now), false);
  });

  await test("a future-dated or malformed persisted proof is never trusted", () => {
    const now = 5_000_000;
    const state = new GateProofState(LIMITS);
    assert.equal(state.restore(now + 60_000, now), false, "clock skew / tampering");
    assert.equal(state.restore(0, now), false);
    assert.equal(state.restore(Number.NaN, now), false);
    assert.equal(state.mayClaimOnline(now), false);
  });

  // --- the heartbeat-loop invariant ---------------------------------------

  await test("reading the proof is synchronous and pure — the heartbeat loop cannot block on it", () => {
    // The structural guarantee behind "keep gate checks outside the heartbeat
    // loop": the tick's only gate dependency is an in-memory read. If this
    // ever became async, a slow diagnostic could stall the heartbeat again.
    const state = new GateProofState(LIMITS);
    state.record({ kind: "passed", durationMs: 20_000 }, 1_000);
    // `typeof === "boolean"` IS the proof: a Promise would report "object".
    const result: unknown = state.mayClaimOnline(2_000);
    assert.equal(typeof result, "boolean");
    assert.equal(typeof state.health(2_000), "string");
    assert.equal(typeof state.nextRefreshDelayMs(), "number");
  });

  /**
   * === Incident #33 ===
   *
   * The gate-check bound was 300s while the command it bounds wanted a shade
   * over 300s. Every refresh was killed AT the bound — production logged four
   * consecutive `durationMs` of 300244/300164/300165/300406 on 2026-08-08 —
   * so no check ever reached a verdict, no proof could ever be renewed, and
   * the runtime went dark each time the cached proof aged out (heartbeat
   * withheld 15:28-15:57, then again from 16:41).
   *
   * The one invocation allowed to finish took 314,314ms. A bound must exceed
   * the cost of what it bounds, with margin.
   */
  await test("Incident #33: the gate-check bound exceeds the observed cost of the command it bounds", () => {
    const OBSERVED_COMPLETION_MS = 314_314;
    assert.ok(
      DEFAULT_GATE_CHECK_LIMITS.timeoutMs > OBSERVED_COMPLETION_MS,
      `the bound must exceed the ${OBSERVED_COMPLETION_MS}ms the command was measured taking, ` +
        `got ${DEFAULT_GATE_CHECK_LIMITS.timeoutMs}ms`
    );
  });

  await test("Incident #33: a refresh still cannot outlive its own cadence or freshness window", () => {
    // The raise is only safe while these orderings hold: a check must finish
    // before the next refresh is due (or refreshes overlap), and many checks
    // must fit inside one freshness window (or a proof can expire with no
    // chance to renew it — the exact outage this incident is about).
    assert.ok(
      DEFAULT_GATE_CHECK_LIMITS.timeoutMs < DEFAULT_GATE_CHECK_LIMITS.refreshMs,
      "a gate check must finish before the next refresh is scheduled"
    );
    assert.ok(
      DEFAULT_GATE_CHECK_LIMITS.refreshMs < DEFAULT_GATE_CHECK_LIMITS.freshnessMs,
      "a proof must be refreshable more than once before it expires"
    );
    assert.ok(
      DEFAULT_GATE_CHECK_LIMITS.timeoutMs * 2 < DEFAULT_GATE_CHECK_LIMITS.freshnessMs,
      "at least two full-length checks must fit inside one freshness window"
    );
  });

  console.log("okx-gate-check-proof: all passed");
}

run();
