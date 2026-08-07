/**
 * Incident #17 + #18 regression battery — the OKX marketplace review-readiness
 * failures, pinned against the real production traces they came from.
 *
 * === #17: a version-staleness advisory took a healthy agent offline ===
 * Live on repodiet-agent-9636, 2026-08-07: the heartbeat had been withheld 328
 * consecutive cycles (~5.5 hours) on `gateOk:false`,
 * `gate_not_ready:ready,communication`, a CONFIRMED failure that completed in
 * 13s — not a timeout — while `daemonOk` and `xmtpOk` were true throughout.
 * Reading `okx-a2a doctor --json` directly showed exactly one failing check out
 * of ten: `cli_version`, "0.1.11 installed; latest stable is 0.2.0". That check
 * compares against npm's LIVE `latest` tag, so no pinned version can satisfy it
 * durably.
 *
 * === #18: a failing heavy job replayed forever and saturated the machine ===
 * `decideRetry` has always computed a `delayMs` that nothing ever honoured, and
 * startup recovery replayed every unfinished event immediately. Funded job
 * 0x22a2…'s `job_accepted` fails inside the heavy repository pipeline, so each
 * replay re-ran clone + install + analyzer + verification on a
 * shared-cpu-1x/2GB machine until the gate check timed out, the heartbeat was
 * withheld, and the machine restarted — straight back into an immediate replay.
 * The only lever that existed was suspending ALL system events globally, which
 * also blocks every legitimate NEW job.
 *
 * The invariant these tests exist to protect: a stale or expensive job must
 * NEVER prevent RepoDiet from answering a new customer or reviewer.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { LedgerActionStore } from "../src/lib/okx-runtime/system-event-intake";
import { deprioritize } from "../src/lib/execution/workspace-install";
import {
  FileActionLedger,
  actionLedgerPath,
  type LedgerRecord,
} from "../src/lib/okx-runtime/action-ledger";
import {
  classifyDoctorChecks,
  classifyGateCheckOutcome,
  DEFAULT_GATE_CHECK_LIMITS,
  GateProofState,
} from "../src/lib/okx-runtime/gate-check-proof";
import {
  HeavyJobRejected,
  currentHeavyJob,
  resetHeavyJobLimiterForTests,
  runExclusiveHeavyJob,
} from "../src/lib/okx-runtime/heavy-job-limiter";
import { decideRetry, MAX_ATTEMPTS } from "../src/lib/okx-runtime/system-event-route";
import { executeSystemEvent } from "../src/lib/okx-runtime/provider-event-executor";
import { decideReply } from "../openclaw-plugins/repodiet-a2a-bridge/logic.js";

let failures = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  ✗ ${name}`);
    console.error(err);
  }
}

const AGENT = "9636";
const FUNDED_JOB = "0x22a216415e2b1176d2111b136584e42fd949f7c0cfca48c657a7d1ca8e6927c6";

function freshLedger(): { ledger: FileActionLedger; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-readiness-"));
  return { ledger: new FileActionLedger(actionLedgerPath(dir), AGENT), dir };
}

/**
 * The real shape of `okx-a2a doctor --json`, captured verbatim from the live
 * production Machine on 2026-08-07 (trimmed to the fields the classifier
 * reads). Not a hand-invented approximation of what doctor "probably" emits.
 */
function doctorStdout(overrides: Array<{ id: string; status: string }> = []): string {
  const base = [
    { id: "node_version", status: "pass" },
    { id: "npm_available", status: "pass" },
    { id: "cli_version", status: "pass" },
    { id: "provider_binding", status: "pass" },
    { id: "gateway_plugin", status: "pass" },
    { id: "gateway_config", status: "pass" },
    { id: "autostart", status: "pass" },
    { id: "daemon_running", status: "pass" },
    { id: "agent_refresh", status: "pass" },
    { id: "gateway_reachable", status: "pass" },
  ];
  for (const override of overrides) {
    const found = base.find((c) => c.id === override.id);
    if (found) found.status = override.status;
    else base.push(override);
  }
  return JSON.stringify({ ok: false, ready: false, checks: base });
}

/** gate-check output for the exact live failure: not ready, sole complaint communication. */
function gateCheckNotReadyStdout(): string {
  return JSON.stringify({
    ok: true,
    data: {
      ready: false,
      identity: { agentId: AGENT, name: "RepoDiet", ok: true, role: "asp", status: 2 },
      communication: { ok: false, hint: "1 issue(s) found; all are auto-fixable." },
      wallet: { ok: true, accountId: "193f3fe6-175a-4cbf-89cb-3afb66033365" },
    },
  });
}

async function main(): Promise<void> {
  console.log("okx-review-response-readiness");

  // ---------------------------------------------------------------- #17 ----
  console.log(" gate proof: a staleness advisory is not evidence of a broken channel");

  await test("the exact live failure — not ready, sole failing doctor check is cli_version — is classified PASSED, and names the advisory rather than claiming a clean pass", () => {
    const outcome = classifyGateCheckOutcome({
      stdout: gateCheckNotReadyStdout(),
      durationMs: 13_474,
      expectedAgentId: AGENT,
      timeoutMs: DEFAULT_GATE_CHECK_LIMITS.timeoutMs,
      doctorStdout: doctorStdout([{ id: "cli_version", status: "fail" }]),
    });
    assert.equal(outcome.kind, "passed");
    assert.ok(
      outcome.kind === "passed" && outcome.advisories?.some((a) => a.startsWith("cli_version:")),
      "the advisory must be reported, so this can never read as an unqualified clean pass"
    );
  });

  await test("a genuinely broken channel still CONFIRMED-fails: daemon_running failing is never forgiven", () => {
    const outcome = classifyGateCheckOutcome({
      stdout: gateCheckNotReadyStdout(),
      durationMs: 12_000,
      expectedAgentId: AGENT,
      timeoutMs: DEFAULT_GATE_CHECK_LIMITS.timeoutMs,
      doctorStdout: doctorStdout([
        { id: "cli_version", status: "fail" },
        { id: "daemon_running", status: "fail" },
      ]),
    });
    assert.equal(outcome.kind, "failed");
    assert.ok(outcome.kind === "failed" && outcome.reason.includes("daemon_running"));
  });

  await test("every communication-bearing check is individually able to fail the gate — none was accidentally left in the advisory set", () => {
    for (const id of [
      "node_version",
      "npm_available",
      "provider_binding",
      "gateway_plugin",
      "gateway_config",
      "daemon_running",
      "agent_refresh",
      "gateway_reachable",
    ]) {
      const outcome = classifyGateCheckOutcome({
        stdout: gateCheckNotReadyStdout(),
        durationMs: 1_000,
        expectedAgentId: AGENT,
        timeoutMs: DEFAULT_GATE_CHECK_LIMITS.timeoutMs,
        doctorStdout: doctorStdout([{ id, status: "fail" }]),
      });
      assert.equal(outcome.kind, "failed", `${id} must be able to fail the gate`);
    }
  });

  await test("an UNRECOGNISED failing check is treated as blocking — a future doctor release cannot silently widen the amnesty", () => {
    const outcome = classifyGateCheckOutcome({
      stdout: gateCheckNotReadyStdout(),
      durationMs: 1_000,
      expectedAgentId: AGENT,
      timeoutMs: DEFAULT_GATE_CHECK_LIMITS.timeoutMs,
      doctorStdout: doctorStdout([{ id: "some_future_check", status: "fail" }]),
    });
    assert.equal(outcome.kind, "failed");
    assert.ok(outcome.kind === "failed" && outcome.reason.includes("some_future_check"));
  });

  await test("missing or unreadable doctor evidence keeps the original fail-closed verdict — absent evidence never upgrades a verdict", () => {
    for (const evidence of [undefined, "", "not json", JSON.stringify({ ok: false }), JSON.stringify({ checks: [] })]) {
      const outcome = classifyGateCheckOutcome({
        stdout: gateCheckNotReadyStdout(),
        durationMs: 1_000,
        expectedAgentId: AGENT,
        timeoutMs: DEFAULT_GATE_CHECK_LIMITS.timeoutMs,
        doctorStdout: evidence,
      });
      assert.equal(outcome.kind, "failed", `evidence ${JSON.stringify(evidence)} must not rescue the gate`);
    }
  });

  await test("a bad identity or a bad wallet is never reconsidered, however clean the doctor evidence is", () => {
    const advisoryOnly = doctorStdout([{ id: "cli_version", status: "fail" }]);
    const wrongIdentity = classifyGateCheckOutcome({
      stdout: JSON.stringify({
        ok: true,
        data: {
          ready: false,
          identity: { agentId: "5295" },
          communication: { ok: false },
          wallet: { ok: true },
        },
      }),
      durationMs: 1_000,
      expectedAgentId: AGENT,
      timeoutMs: DEFAULT_GATE_CHECK_LIMITS.timeoutMs,
      doctorStdout: advisoryOnly,
    });
    assert.equal(wrongIdentity.kind, "failed");

    const badWallet = classifyGateCheckOutcome({
      stdout: JSON.stringify({
        ok: true,
        data: {
          ready: false,
          identity: { agentId: AGENT },
          communication: { ok: false },
          wallet: { ok: false },
        },
      }),
      durationMs: 1_000,
      expectedAgentId: AGENT,
      timeoutMs: DEFAULT_GATE_CHECK_LIMITS.timeoutMs,
      doctorStdout: advisoryOnly,
    });
    assert.equal(badWallet.kind, "failed");
    assert.ok(badWallet.kind === "failed" && badWallet.reason.includes("wallet"));
  });

  await test("a timeout is still INCONCLUSIVE, not a pass — Incident #15's distinction is untouched", () => {
    const outcome = classifyGateCheckOutcome({
      error: { code: "ETIMEDOUT", message: "timed out" },
      durationMs: DEFAULT_GATE_CHECK_LIMITS.timeoutMs,
      expectedAgentId: AGENT,
      timeoutMs: DEFAULT_GATE_CHECK_LIMITS.timeoutMs,
      doctorStdout: doctorStdout([{ id: "cli_version", status: "fail" }]),
    });
    assert.equal(outcome.kind, "inconclusive");
  });

  await test("classifyDoctorChecks ignores warn/skipped — only a real fail counts against the gate", () => {
    const evidence = classifyDoctorChecks(
      doctorStdout([
        { id: "cli_version", status: "warn" },
        { id: "gateway_reachable", status: "skipped" },
      ])
    );
    assert.equal(evidence.kind, "advisory_only");
  });

  await test("HEARTBEAT REMAINS HEALTHY: after the advisory-only pass the proof is fresh, so the runtime may claim online", () => {
    const proof = new GateProofState();
    proof.record(
      classifyGateCheckOutcome({
        stdout: gateCheckNotReadyStdout(),
        durationMs: 13_474,
        expectedAgentId: AGENT,
        timeoutMs: DEFAULT_GATE_CHECK_LIMITS.timeoutMs,
        doctorStdout: doctorStdout([{ id: "cli_version", status: "fail" }]),
      })
    );
    assert.equal(proof.mayClaimOnline(), true);
    assert.equal(proof.health(), "proven");
  });

  // ---------------------------------------------------------------- #18 ----
  console.log(" quarantine: one stuck job must not stop anything else");

  await test("RESTART DOES NOT REPLAY: a record deferred into the future is withheld from recovery, then returns once due", () => {
    const { ledger } = freshLedger();
    const dueAt = Date.now() + 30 * 60_000;
    ledger.put("evt-funded", {
      state: "retryable_failure",
      jobId: FUNDED_JOB,
      semanticKey: "sk-funded",
      attempts: 9,
      retryAfterIso: new Date(dueAt).toISOString(),
    });

    // A brand-new instance — this is the restart path, read from disk.
    assert.deepEqual(ledger.pendingForRecovery().map((r) => r.eventId), []);
    assert.deepEqual(ledger.deferredForRecovery().map((r) => r.eventId), ["evt-funded"]);

    // One millisecond past due, it is offered again.
    assert.deepEqual(
      ledger.pendingForRecovery(dueAt + 1).map((r) => r.eventId),
      ["evt-funded"]
    );
  });

  await test("PENDING STATE IS PRESERVED: a deferred record keeps its envelope, jobId, attempts and unacknowledged state — deferral is never a decision", () => {
    const { ledger, dir } = freshLedger();
    const envelope = { agentId: AGENT, message: { source: "system", event: "job_accepted", jobId: FUNDED_JOB } };
    ledger.put("evt-funded", {
      state: "retryable_failure",
      jobId: FUNDED_JOB,
      semanticKey: "sk-funded",
      attempts: 9,
      envelope: envelope as never,
      retryAfterIso: new Date(Date.now() + 60_000).toISOString(),
    });

    const reopened = new FileActionLedger(actionLedgerPath(dir), AGENT);
    const record = reopened.get("evt-funded") as LedgerRecord;
    assert.equal(record.acknowledged, false);
    assert.notEqual(record.state, "terminal_failure");
    assert.equal(record.jobId, FUNDED_JOB);
    assert.equal(record.attempts, 9);
    assert.deepEqual(record.envelope, envelope);
  });

  await test("A STUCK JOB DOES NOT BLOCK OTHERS: a healthy event arriving while the funded job is quarantined is offered for recovery immediately", () => {
    const { ledger } = freshLedger();
    ledger.put("evt-funded", {
      state: "retryable_failure",
      jobId: FUNDED_JOB,
      semanticKey: "sk-funded",
      attempts: 12,
      retryAfterIso: new Date(Date.now() + 60 * 60_000).toISOString(),
    });
    ledger.put("evt-reviewer", {
      state: "discovered",
      jobId: "0xreviewer",
      semanticKey: "sk-reviewer",
      attempts: 0,
    });

    assert.deepEqual(
      ledger.pendingForRecovery().map((r) => r.eventId),
      ["evt-reviewer"],
      "the new reviewer event must be recoverable while the old one is quarantined"
    );
  });

  await test("a corrupt retryAfterIso fails OPEN into a retry — a bad timestamp can never defer an event indefinitely", () => {
    const { ledger } = freshLedger();
    ledger.put("evt-corrupt", {
      state: "retryable_failure",
      jobId: FUNDED_JOB,
      semanticKey: "sk-corrupt",
      attempts: 1,
      retryAfterIso: "not-a-date",
    });
    assert.deepEqual(ledger.pendingForRecovery().map((r) => r.eventId), ["evt-corrupt"]);
  });

  await test("BACKOFF IS BOUNDED: it escalates into hours for a repeatedly failing event, is capped, and still terminates at MAX_ATTEMPTS", () => {
    const first = decideRetry({ attempts: 1 });
    const late = decideRetry({ attempts: 12 });
    assert.equal(first.retry, true);
    assert.ok(first.delayMs <= 10_000, `an early retry must stay fast, got ${first.delayMs}ms`);
    assert.ok(late.delayMs >= 30 * 60_000, `a late retry must quarantine for a long time, got ${late.delayMs}ms`);
    assert.ok(late.delayMs <= 3_600_000, "the delay must remain capped, never unbounded");

    const exhausted = decideRetry({ attempts: MAX_ATTEMPTS });
    assert.equal(exhausted.retry, false, "the retry budget must still terminate");
    assert.equal(exhausted.reason, "max_attempts_exhausted");
  });

  await test("a retryable failure RECORDS its own quarantine deadline on the ledger, and a terminal one does not", async () => {
    const { ledger } = freshLedger();
    const envelope = {
      agentId: AGENT,
      message: { source: "system", event: "job_accepted", jobId: FUNDED_JOB },
    };
    const deps = {
      ledger: {
        get: (id: string) => ledger.get(id) as never,
        put: (id: string, evidence: Record<string, unknown>) => {
          ledger.put(id, { ...evidence, jobId: FUNDED_JOB, semanticKey: "sk" } as never);
        },
        tryLock: () => true,
        unlock: () => {},
      },
      // Fails at the first step, which is the retryable path.
      fetchInstruction: async () => ({ ok: false, stdout: "", stderr: "boom" }),
      readTask: async () => undefined,
      runModel: async () => ({ ok: false, actions: [] }),
      runAction: async () => ({ ok: false, broadcast: false }),
      reconcile: async () => ({ completed: false }),
      publishStatus: async () => ({ ok: true }),
    } as never;

    const result = await executeSystemEvent("evt-retry", envelope as never, deps);
    assert.equal(result.state, "retryable_failure");
    const record = ledger.get("evt-retry") as LedgerRecord;
    assert.ok(record.retryAfterIso, "a retryable failure must record when it may next be tried");
    assert.ok(
      Date.parse(record.retryAfterIso!) > Date.now(),
      "the quarantine deadline must be in the future, or it defers nothing"
    );
    assert.equal(record.acknowledged, false, "a deferred event must never be acknowledged");
  });

  /**
   * The seam the original Incident #18 coverage missed.
   *
   * `persistRetryable` computed the deadline and `FileActionLedger` had the
   * column, but `LedgerActionStore` — the adapter the PRODUCTION runtime
   * actually injects — enumerates the fields it forwards and did not list
   * `retryAfterIso`, so it was dropped in between. Live production showed the
   * deadline on 0 of 33 records: the quarantine was a complete no-op, every
   * failing event stayed immediately due, and the machine kept re-running the
   * heavy pipeline on every poll.
   *
   * The earlier tests passed because they drove `FileActionLedger` directly.
   * This one goes through the real store in both directions, so a field that
   * survives the executor but not the adapter fails here.
   */
  await test("the PRODUCTION ledger adapter round-trips the quarantine deadline — not just the raw file ledger", () => {
    const { ledger } = freshLedger();
    const store = new LedgerActionStore(ledger);
    const dueAt = new Date(Date.now() + 30 * 60_000).toISOString();

    store.put("evt-through-store", {
      state: "retryable_failure",
      attempts: 7,
      error: "NO_SAFE_CANDIDATES",
      retryAfterIso: dueAt,
    });

    // It must reach the DURABLE record, not merely the in-memory evidence.
    assert.equal(
      ledger.get("evt-through-store")?.retryAfterIso,
      dueAt,
      "the adapter must forward retryAfterIso to the durable ledger"
    );
    // And it must come back out, so `prior` carries it on the next attempt.
    assert.equal(store.get("evt-through-store")?.retryAfterIso, dueAt);
    // The whole point: a record written through the real adapter is deferred.
    assert.deepEqual(ledger.pendingForRecovery().map((r) => r.eventId), []);
    assert.deepEqual(
      ledger.deferredForRecovery().map((r) => r.eventId),
      ["evt-through-store"]
    );
  });

  // ------------------------------------------------------- Incident #22 ----
  console.log(" heavy work must never outrank the agent's liveness calls");

  /**
   * Measured on the production Machine on 2026-08-07: a SINGLE cleanup attempt
   * (`npm install` then `next build` plus its jest-workers) drove the 1-vCPU
   * box to load 11+, the 150s gate-check timed out repeatedly, and the agent
   * withheld its heartbeat for the whole ~20-minute run with `daemonOk:true`
   * and `xmtpOk:true`. The quarantine stops that running CONTINUOUSLY; this
   * stops the one permitted attempt from starving the agent while it runs.
   */
  await test("every heavy spawn site lowers its child's scheduling priority, and the runtime's own priority is never touched", () => {
    const root = path.join(__dirname, "..", "src", "lib");
    const sites = [
      ["execution", "workspace-install.ts"],
      ["execution", "baseline-verification.ts"],
      ["verify", "run-verification.ts"],
    ];
    for (const parts of sites) {
      const src = fs.readFileSync(path.join(root, ...parts), "utf8");
      assert.ok(
        /deprioritize\(\s*child\.pid/.test(src),
        `${parts.join("/")} must lower the priority of the child it spawns`
      );
      // Renicing the runtime itself would slow the very heartbeat this
      // protects, so `process.pid` must never be the target.
      assert.ok(
        !/setPriority\(\s*process\.pid/.test(src),
        `${parts.join("/")} must never deprioritise the runtime process itself`
      );
    }
  });

  await test("deprioritize is best-effort — an unsupported platform or an already-exited child never breaks the pipeline", () => {
    // A pid that cannot exist: setPriority throws, and the helper must swallow.
    assert.doesNotThrow(() => deprioritize(2 ** 30, "test"));
    assert.doesNotThrow(() => deprioritize(undefined, "test"));
  });

  // ------------------------------------------------------- Incident #21 ----
  console.log(" quarantine is per-JOB, not merely per-event");

  /**
   * Observed live on 2026-08-07: the funded job owned fourteen live events,
   * each with its own staggered backoff, so something was always due and heavy
   * repository work ran back-to-back. Load stayed between 7 and 15, the 150s
   * gate-check timed out repeatedly, and the agent withheld its heartbeat for
   * 20 consecutive cycles with `daemonOk:true` and `xmtpOk:true`. Nothing
   * crashed — the box never got quiet enough to re-prove itself.
   */
  await test("deferring ONE event quarantines its whole job — a job cannot round-robin through its events", () => {
    const { ledger } = freshLedger();
    // Three live events for the same failing job; only one is deferred.
    ledger.put("evt-a", { state: "retryable_failure", jobId: FUNDED_JOB, semanticKey: "a", attempts: 3 });
    ledger.put("evt-b", { state: "instruction_fetched", jobId: FUNDED_JOB, semanticKey: "b", attempts: 2 });
    ledger.put("evt-c", {
      state: "retryable_failure",
      jobId: FUNDED_JOB,
      semanticKey: "c",
      attempts: 9,
      retryAfterIso: new Date(Date.now() + 30 * 60_000).toISOString(),
    });

    assert.deepEqual(
      ledger.pendingForRecovery().map((r) => r.eventId),
      [],
      "the job's other events must not keep the machine busy while one is quarantined"
    );
    assert.equal(
      ledger.deferredForRecovery().length,
      3,
      "all three must be reported as deferred, so every live record is accounted for"
    );
  });

  await test("a DIFFERENT job is completely unaffected by another job's quarantine", () => {
    const { ledger } = freshLedger();
    ledger.put("evt-stuck", {
      state: "retryable_failure",
      jobId: FUNDED_JOB,
      semanticKey: "stuck",
      attempts: 13,
      retryAfterIso: new Date(Date.now() + 60 * 60_000).toISOString(),
    });
    ledger.put("evt-reviewer", {
      state: "discovered",
      jobId: "0xreviewer-new-job",
      semanticKey: "rev",
      attempts: 0,
    });

    assert.deepEqual(
      ledger.pendingForRecovery().map((r) => r.eventId),
      ["evt-reviewer"],
      "a reviewer's new job must never be held back by the stuck one"
    );
  });

  await test("the job's events return together once the longest deadline passes", () => {
    const { ledger } = freshLedger();
    const dueAt = Date.now() + 10 * 60_000;
    ledger.put("evt-x", { state: "retryable_failure", jobId: FUNDED_JOB, semanticKey: "x", attempts: 1 });
    ledger.put("evt-y", {
      state: "retryable_failure",
      jobId: FUNDED_JOB,
      semanticKey: "y",
      attempts: 8,
      retryAfterIso: new Date(dueAt).toISOString(),
    });
    assert.deepEqual(ledger.pendingForRecovery().map((r) => r.eventId), []);
    assert.deepEqual(
      ledger.pendingForRecovery(dueAt + 1).map((r) => r.eventId).sort(),
      ["evt-x", "evt-y"]
    );
  });

  // ------------------------------------------------------- Incident #20 ----
  console.log(" a proof is never allowed to expire without a check being attempted");

  /**
   * Observed live on 2026-08-07. On boot the runtime restored a persisted proof
   * already 42 minutes old — still inside the 45-minute freshness window, so it
   * correctly skipped the blocking initial check — then scheduled the next
   * refresh a full 15 minutes away. The proof expired three minutes later and
   * the agent withheld its heartbeat for nine consecutive cycles with
   * `gate_check_result` appearing ZERO times: the cadence was chosen purely
   * from the last outcome, ignoring how long its evidence had left.
   */
  await test("a nearly-expired proof schedules its refresh BEFORE expiry, not a full interval later", () => {
    const limits = DEFAULT_GATE_CHECK_LIMITS;
    const proof = new GateProofState(limits);
    const now = Date.now();
    // Exactly the live case: restored proof, 42 minutes old, 3 minutes of life.
    assert.equal(proof.restore(now - 42 * 60_000, now), true);

    const remaining = proof.msUntilProofExpiry(now);
    const delay = proof.nextRefreshDelayMs(now);
    assert.ok(remaining > 0 && remaining < limits.refreshMs, "precondition: proof expires before a normal refresh");
    assert.ok(
      delay < remaining,
      `the next check must start before the proof dies (delay ${delay}ms vs ${remaining}ms remaining)`
    );
    assert.ok(
      delay + limits.timeoutMs <= remaining || delay === limits.expiryFloorMs,
      "the check must also have time to FINISH before expiry, unless already at the floor"
    );
    assert.ok(delay >= limits.expiryFloorMs, "never faster than the floor");
  });

  await test("a healthy fresh proof still uses the normal slow cadence — this does not make checks more frequent in the good case", () => {
    const limits = DEFAULT_GATE_CHECK_LIMITS;
    const proof = new GateProofState(limits);
    const now = Date.now();
    proof.record({ kind: "passed", durationMs: 16_000 }, now);
    assert.equal(proof.nextRefreshDelayMs(now), limits.refreshMs);
  });

  /**
   * The clamp is deliberately ASYMMETRIC and must not apply once the proof is
   * gone. Flooring there would re-launch a 150s command every 60s exactly when
   * checks are timing out because the machine is overloaded — the spiral
   * Incident #14 documented. An earlier draft of this fix did precisely that,
   * and `okx-gate-check-proof.test.ts`'s backoff assertion caught it.
   */
  await test("with NO live proof the clamp does not apply — the inconclusive backoff still paces an expensive command", () => {
    const limits = DEFAULT_GATE_CHECK_LIMITS;
    const now = Date.now();

    const expired = new GateProofState(limits);
    expired.record({ kind: "passed", durationMs: 1_000 }, now - limits.freshnessMs - 1_000);
    assert.equal(expired.mayClaimOnline(now), false, "precondition: the proof is gone");
    for (let i = 0; i < 3; i++) {
      expired.record({ kind: "inconclusive", durationMs: limits.timeoutMs, reason: "timeout" }, now);
    }
    assert.equal(
      expired.nextRefreshDelayMs(now),
      240_000,
      "backoff must keep escalating instead of hammering at the floor"
    );
  });

  await test("the clamp can never schedule faster than the floor, at any inconclusive depth", () => {
    const limits = DEFAULT_GATE_CHECK_LIMITS;
    const proof = new GateProofState(limits);
    const now = Date.now();
    proof.restore(now - (limits.freshnessMs - 1_000), now); // 1s of life left
    for (let i = 0; i < 12; i++) proof.record({ kind: "inconclusive", durationMs: 1, reason: "timeout" }, now);
    assert.ok(proof.nextRefreshDelayMs(now) >= limits.expiryFloorMs);
  });

  // ------------------------------------------------------- Incident #19 ----
  console.log(" liveness is never gated on job work");

  /**
   * Reproduced live on 2026-08-07, right after the Incident #18 deploy: boot
   * logged `system_event_recovery_start {"pending":11}` and then nothing at
   * all from this runtime for 20+ minutes — no `system_event_recovered`, no
   * `open_job_reconciler_wired`, and not one `heartbeat_accepted` OR
   * `heartbeat_withheld`, while a `npm install` child from the first event
   * kept running. `main()` awaited recovery before arming the heartbeat, so a
   * single stuck job took the agent dark.
   */
  await test("startup NEVER awaits recovery or the open-job sweep before arming the heartbeat", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "scripts", "repodiet-seller-runtime.ts"),
      "utf8"
    );
    assert.ok(
      /void recoverPendingEvents\(/.test(src),
      "startup recovery must be detached, not awaited"
    );
    /**
     * `runSystemEventCycle` legitimately awaits recovery — that call is INSIDE
     * the poll cycle, which already runs on a timer behind
     * `systemEventCycleInFlight` and so cannot gate startup. Only the call in
     * `main()` mattered, so the assertion is scoped to main() rather than to
     * the whole file.
     */
    const mainBody = src.slice(src.indexOf("async function main("));
    assert.ok(mainBody.length > 0, "main() must exist");
    assert.ok(
      !/\bawait recoverPendingEvents\(/.test(mainBody),
      "awaiting startup recovery in main() is what took the agent dark in Incident #19"
    );
    assert.ok(
      !/\bawait runOpenJobSweep\(/.test(mainBody),
      "the open-job sweep must not gate the heartbeat either"
    );
    // The heartbeat must still actually be armed.
    assert.ok(/heartbeatTimer = setInterval\(/.test(src), "the heartbeat timer must be armed");
  });

  await test("one event that never settles cannot own the recovery loop — it is bounded and the loop continues", async () => {
    const { ledger } = freshLedger();
    const envelope = {
      agentId: AGENT,
      message: { source: "system", event: "job_accepted", jobId: FUNDED_JOB },
    };
    const previous = process.env.REPODIET_EVENT_EXECUTION_TIMEOUT_MS;
    process.env.REPODIET_EVENT_EXECUTION_TIMEOUT_MS = "50";
    try {
      // Re-import so the module-level bound picks up the override.
      const mod = await import(
        `../src/lib/okx-runtime/system-event-reconciler?bound=${Date.now()}`
      );
      const logs: string[] = [];
      const results = await mod.recoverPendingEvents({
        pending: () => [
          { eventId: "evt-hang", envelope },
          { eventId: "evt-next", envelope },
        ],
        ledger: {
          get: (id: string) => ledger.get(id),
          put: (id: string, e: Record<string, unknown>) =>
            ledger.put(id, { ...e, jobId: FUNDED_JOB, semanticKey: "sk" } as never),
          tryLock: () => true,
          unlock: () => {},
        },
        // The first event hangs forever; the second completes normally.
        fetchInstruction: async (input: { jobId: string }) => {
          void input;
          if (logs.includes("hang")) return { ok: false, stdout: "", stderr: "x" };
          logs.push("hang");
          return new Promise(() => {});
        },
        readTask: async () => undefined,
        runModel: async () => ({ ok: false, actions: [] }),
        runAction: async () => ({ ok: false, broadcast: false }),
        reconcile: async () => ({ completed: false }),
        publishStatus: async () => ({ ok: true }),
        log: (event: string) => logs.push(event),
      } as never);

      assert.ok(
        logs.includes("system_event_recovery_error"),
        "the hung event must be reported, not silently swallowed"
      );
      assert.ok(
        logs.includes("system_event_recovery_complete"),
        "the loop must finish rather than being owned by the hung event"
      );
      assert.equal(results.length, 1, "the event AFTER the hung one must still have executed");
      assert.equal(
        ledger.get("evt-hang")?.acknowledged,
        undefined,
        "a timed-out event must never be acknowledged"
      );
    } finally {
      if (previous === undefined) delete process.env.REPODIET_EVENT_EXECUTION_TIMEOUT_MS;
      else process.env.REPODIET_EVENT_EXECUTION_TIMEOUT_MS = previous;
    }
  });

  // ------------------------------------------------------- heavy limiter ----
  console.log(" heavy-job limiter: bounded, exclusive, and always replayable");

  await test("ONE HEAVY JOB AT A TIME: a second concurrent repository execution is refused rather than run", async () => {
    resetHeavyJobLimiterForTests();
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runExclusiveHeavyJob("cleanup_pr:job-a", async () => {
      await held;
      return "a";
    });

    await assert.rejects(
      () => runExclusiveHeavyJob("cleanup_pr:job-b", async () => "b"),
      (err: unknown) =>
        err instanceof HeavyJobRejected && err.code === "heavy_job_already_running"
    );

    release!();
    assert.equal(await first, "a");
    assert.equal(currentHeavyJob(), undefined, "the slot must be released when the job finishes");
  });

  await test("HEAVY TIMEOUT: a job that outlives its bound is abandoned, the slot is released, and the signal is aborted", async () => {
    resetHeavyJobLimiterForTests();
    let observed: AbortSignal | undefined;
    await assert.rejects(
      () =>
        runExclusiveHeavyJob(
          "cleanup_pr:wedged",
          (signal) => {
            observed = signal;
            return new Promise(() => {});
          },
          { timeoutMs: 20 }
        ),
      (err: unknown) => err instanceof HeavyJobRejected && err.code === "heavy_job_timeout"
    );
    assert.equal(observed?.aborted, true, "the pipeline must be told to stop");
    assert.equal(
      currentHeavyJob(),
      undefined,
      "a wedged job must not hold the machine's only heavy slot forever"
    );

    // The slot is genuinely reusable afterwards.
    assert.equal(await runExclusiveHeavyJob("cleanup_pr:next", async () => "ok"), "ok");
  });

  await test("the slot is released when the heavy job throws, not only when it succeeds", async () => {
    resetHeavyJobLimiterForTests();
    await assert.rejects(() =>
      runExclusiveHeavyJob("cleanup_pr:boom", async () => {
        throw new Error("pipeline failed");
      })
    );
    assert.equal(currentHeavyJob(), undefined);
  });

  // ----------------------------------------------- reviewer response path ----
  console.log(" reviewer path: answered while the funded job is quarantined");

  /**
   * The conversation path is structurally independent of the system-event
   * path: XMTP → okx-a2a daemon → OpenClaw → this bridge → HTTPS to the
   * production API. These tests hold a heavy job AND a quarantined ledger
   * record open for the whole exchange and assert the reply still happens, so
   * a future change that couples the two fails here rather than in review.
   */
  const reviewerMessages = [
    "I would like to use the services of agent ID 9636",
    "What services do you provide?",
    "I have a GitHub repository with dead code. Can RepoDiet help?",
  ];

  for (const message of reviewerMessages) {
    await test(`FRESH MESSAGE ANSWERED WHILE A HEAVY JOB HOLDS THE MACHINE: "${message}"`, async () => {
      resetHeavyJobLimiterForTests();
      const { ledger } = freshLedger();
      ledger.put("evt-funded", {
        state: "retryable_failure",
        jobId: FUNDED_JOB,
        semanticKey: "sk-funded",
        attempts: 14,
        retryAfterIso: new Date(Date.now() + 60 * 60_000).toISOString(),
      });

      let release: (() => void) | undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const heavy = runExclusiveHeavyJob("cleanup_pr:funded", async () => {
        await held;
        return "done";
      });

      const published: string[] = [];
      const startedAt = Date.now();
      const result = await decideReply(
        { cleanedBody: message },
        { sessionKey: "agent:main:okx-a2a:group:okx-xmtp:my=9636&to=8178", messageId: `m-${message.length}` },
        {
          // The real backend's own classification, relayed verbatim — the same
          // endpoint OKX's reviewer already reaches over plain HTTPS.
          dispatchCreateTask: async () => ({
            status: 200,
            body: {
              message:
                "RepoDiet here. I offer Quick Triage (A2MCP, 0.03 USD₮0) and Verified Cleanup (A2A, 1 USD₮0). Send a GitHub repository URL to begin.",
            },
          }),
          dispatchAnalyzeRepository: async () => ({ status: 402, body: {} }),
          publishReply: async ({ text }: { text: string }) => {
            published.push(text);
            return { ok: true, messageId: `out-${published.length}` };
          },
          getPublication: () => undefined,
          recordPublication: () => {},
          getRecordedDispatch: () => undefined,
          recordDispatch: () => {},
          log: () => {},
        }
      );

      const elapsedMs = Date.now() - startedAt;
      assert.equal(result.handled, true, "the bridge must claim the turn, never fall through to a model");
      assert.ok(result.reply?.text, "a reply must actually be generated");
      assert.equal(published.length, 1, "the reply must be published onto the transport exactly once");
      assert.ok(
        elapsedMs < 5_000,
        `the conversation path must stay fast while heavy work runs, took ${elapsedMs}ms`
      );

      // Still quarantined, still untouched — answering a reviewer never
      // disturbs, resumes or decides the funded job.
      assert.deepEqual(ledger.pendingForRecovery().map((r) => r.eventId), []);
      assert.equal((ledger.get("evt-funded") as LedgerRecord).acknowledged, false);

      release!();
      await heavy;
    });
  }

  await test("NO DUPLICATE DELIVERY: an already-published inbound message is never published a second time", async () => {
    const published: string[] = [];
    const result = await decideReply(
      { cleanedBody: "What services do you provide?" },
      { sessionKey: "job:0xabc:my:9636:to:8178", messageId: "m-dup" },
      {
        dispatchCreateTask: async () => ({ status: 200, body: { message: "RepoDiet services." } }),
        publishReply: async ({ text }: { text: string }) => {
          published.push(text);
          return { ok: true, messageId: "out-1" };
        },
        // This inbound message's reply is already on the wire.
        getPublication: () => ({ ok: true, messageId: "out-original" }),
        recordPublication: () => {},
        getRecordedDispatch: () => undefined,
        recordDispatch: () => {},
        log: () => {},
      }
    );
    assert.equal(result.handled, true, "the turn must still be claimed so it cannot reach a model");
    assert.equal(published.length, 0, "a redelivered envelope must never produce a second reply");
  });

  // --------------------------------------------------- A2MCP SDK remains ----
  console.log(" A2MCP: the official OKX Payment SDK stays mandatory");

  await test("the paid route's payment boundary is the official SDK, and no code path can make it free", () => {
    const boundary = fs.readFileSync(
      path.join(__dirname, "..", "src", "lib", "payment", "okx-official-x402.ts"),
      "utf8"
    );
    assert.ok(boundary.includes('from "@okxweb3/x402-core"'), "the official facilitator client must be imported");
    assert.ok(boundary.includes("new OKXFacilitatorClient("), "the official facilitator client must be constructed");
    assert.ok(boundary.includes("new ExactEvmScheme()"), "the official exact-EVM scheme must be registered");
    assert.ok(boundary.includes('"eip155:196"'), "the registered network must remain X Layer");
    assert.ok(
      boundary.includes("processSettlement"),
      "settlement must go through the SDK, not a local reimplementation"
    );
    assert.ok(
      boundary.includes("is not payment-protected"),
      "a route the SDK reports as unprotected must throw, never serve free"
    );

    const route = fs.readFileSync(
      path.join(__dirname, "..", "src", "app", "api", "a2mcp", "quick-triage", "route.ts"),
      "utf8"
    );
    assert.ok(
      route.includes("PAYMENT_BOUNDARY_UNAVAILABLE") && route.includes("{ status: 503 }"),
      "missing SDK credentials must fail closed with 503, never fall back to a hand-rolled gate"
    );
    assert.ok(
      !/gateA2mcpCall\(/.test(route),
      "the retired custom gate must not be reachable from this route"
    );
  });

  if (failures > 0) {
    console.error(`okx-review-response-readiness: ${failures} failed`);
    process.exit(1);
  }
  console.log("okx-review-response-readiness: all passed");
}

void main();
