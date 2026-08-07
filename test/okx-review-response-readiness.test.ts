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
  gateFailureMentionsCommunication,
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
import { recoverPendingEvents } from "../src/lib/okx-runtime/system-event-reconciler";
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

  // ------------------------------------------------------- Incident #26 ----
  console.log(" the timeout hierarchy must be internally consistent");

  /**
   * With the seeded candidate finally approved, the real cleanup got past the
   * delivery safety gate and then died on "Dependency install exceeded its time
   * limit". That was a direct consequence of the two availability fixes —
   * `nice 19` (#22) and `--maxsockets 3` (#23) — which deliberately trade
   * install wall-clock for agent liveness. Neither was matched by an increase
   * in the install bound, so an already-tight 180s ceiling became unreachable.
   *
   * Each layer must exceed what it contains, or raising an inner bound just
   * moves the failure outwards.
   */
  await test("each PRODUCTION bound exceeds the work it contains: install < verify-total < heavy-job < event", async () => {
    const install = await import("../src/lib/execution/workspace-install");
    const verify = await import("../src/lib/verify/run-verification");
    const heavy = await import("../src/lib/okx-runtime/heavy-job-limiter");
    const recon = await import("../src/lib/okx-runtime/system-event-reconciler");

    // Asserted on the exported PRODUCTION_* constants, never on the resolved
    // values: the test process deliberately injects tiny bounds (Incident #27),
    // so reading the live values here would assert the test config, not
    // production's.
    const installMs = install.PRODUCTION_INSTALL_TIMEOUT_MS;
    const totalMs = verify.PRODUCTION_VERIFY_TOTAL_TIMEOUT_MS;
    const heavyMs = heavy.PRODUCTION_HEAVY_JOB_TIMEOUT_MS;
    const eventMs = recon.PRODUCTION_EVENT_EXECUTION_TIMEOUT_MS;

    assert.ok(
      installMs > 180_000,
      `the install bound must exceed the 180s at which real installs were being killed, got ${installMs}`
    );
    assert.ok(totalMs > installMs, "a verification pass must outlast a single install inside it");
    assert.ok(heavyMs > totalMs, "the heavy-job ceiling must exceed the verification pass it contains");
    assert.ok(
      eventMs > heavyMs,
      "the per-event deadline must remain a backstop, not a competing deadline"
    );
    assert.ok(eventMs <= 3_600_000, "every bound must stay finite and sane");
  });

  await test("test-injected bounds are small, so no suite can wait a production deadline", () => {
    // Incident #27: the npm scripts inject these. If that ever stops happening,
    // the suite silently starts waiting production wall-clock again and CI gets
    // cancelled rather than failing — the worst possible failure mode.
    for (const name of [
      "REPODIET_INSTALL_TIMEOUT_MS",
      "REPODIET_VERIFY_COMMAND_TIMEOUT_MS",
      "REPODIET_VERIFY_TOTAL_TIMEOUT_MS",
    ]) {
      const raw = process.env[name];
      if (raw === undefined) continue; // running the file directly is allowed
      const v = Number(raw);
      assert.ok(
        Number.isFinite(v) && v > 0 && v <= 300_000,
        `${name}=${raw} is too large for a test run`
      );
    }
  });

  // ------------------------------------------------------- Incident #25 ----
  console.log(" a confirmed failure must be re-checked promptly, not in 15 minutes");

  /**
   * Observed live 20 SECONDS after a deploy restart: the gate-check ran,
   * `okx-a2a doctor` reported `daemon_running` still coming up, and the result
   * was correctly classified as a confirmed failure. The proof died — right —
   * and the next refresh was scheduled a full 900s away, because the backoff
   * only ever considered INCONCLUSIVE results. Eleven consecutive
   * `heartbeat_withheld` followed with `daemonOk:true` and `xmtpOk:true`.
   */
  await test("a confirmed failure schedules a prompt retry, not a full refresh interval", () => {
    const limits = DEFAULT_GATE_CHECK_LIMITS;
    const proof = new GateProofState(limits);
    const now = Date.now();
    proof.record({ kind: "failed", durationMs: 24_066, reason: "gate_not_ready:communication:daemon_running" }, now);
    const delay = proof.nextRefreshDelayMs(now);
    assert.equal(delay, limits.backoffBaseMs, "the first retry after a confirmed failure must be prompt");
    assert.ok(delay < limits.refreshMs, "waiting a whole refresh interval is what caused the outage");
  });

  await test("repeated confirmed failures still escalate and stay capped — a broken gate is never hammered", () => {
    const limits = DEFAULT_GATE_CHECK_LIMITS;
    const proof = new GateProofState(limits);
    const now = Date.now();
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      proof.record({ kind: "failed", durationMs: 1_000, reason: "gate_not_ready:communication:daemon_running" }, now);
      seen.push(proof.nextRefreshDelayMs(now));
    }
    assert.deepEqual(seen.slice(0, 4), [60_000, 120_000, 240_000, 480_000]);
    for (const d of seen) {
      assert.ok(d <= limits.backoffMaxMs, `${d} must stay capped`);
      assert.ok(d <= limits.refreshMs, `${d} must never exceed a normal refresh`);
    }
  });

  await test("prompt retry does NOT weaken the online claim — the agent stays unproven until a check genuinely passes", () => {
    const proof = new GateProofState();
    const now = Date.now();
    proof.record({ kind: "passed", durationMs: 15_000 }, now - 1_000);
    assert.equal(proof.mayClaimOnline(now), true, "precondition: proven");

    proof.record({ kind: "failed", durationMs: 24_000, reason: "gate_not_ready:communication:daemon_running" }, now);
    assert.equal(proof.mayClaimOnline(now), false, "a confirmed failure must kill the claim immediately");
    assert.equal(proof.health(now), "unproven");
    // …and it stays dead across the prompt retry window until a real pass.
    assert.equal(proof.mayClaimOnline(now + 60_000), false);
    proof.record({ kind: "passed", durationMs: 16_000 }, now + 60_000);
    assert.equal(proof.mayClaimOnline(now + 60_000), true, "only a genuine pass restores it");
    assert.equal(
      proof.nextRefreshDelayMs(now + 60_000),
      DEFAULT_GATE_CHECK_LIMITS.refreshMs,
      "recovery must return to the slow cadence"
    );
  });

  // ------------------------------------------------------- Incident #24 ----
  console.log(" the doctor-evidence guard must match what production actually emits");

  /**
   * The Incident #17 doctor-evidence path never ran ONCE in production.
   *
   * `classifyGateCheckOutcome` joins the failing parts with a COMMA, so the
   * real reason is `gate_not_ready:ready,communication` — `ready` is derived
   * from `communication` and always accompanies it. The original guard,
   * `/(^|:)communication(,|:|$)/`, required a colon or string-start before the
   * word, and in the real string it is preceded by a COMMA.
   *
   * It stayed hidden because the path is only needed when `cli_version` fails,
   * which only began when OKX published 0.2.1. Until then the gate passed
   * outright and the branch was never reached — on 2026-08-07 it then withheld
   * the heartbeat for 27 consecutive cycles with every communication-bearing
   * check passing.
   */
  await test("the guard matches the EXACT reason string production emits", () => {
    assert.equal(
      gateFailureMentionsCommunication("gate_not_ready:ready,communication"),
      true,
      "this is the literal value observed in production logs"
    );
    assert.equal(gateFailureMentionsCommunication("gate_not_ready:communication"), true);
    assert.equal(
      gateFailureMentionsCommunication("gate_not_ready:ready,communication,wallet"),
      true
    );
  });

  await test("the guard does NOT fire for failures that are not about communication", () => {
    assert.equal(gateFailureMentionsCommunication("gate_not_ready:wallet"), false);
    assert.equal(gateFailureMentionsCommunication("gate_not_ready:ready,identity"), false);
    assert.equal(gateFailureMentionsCommunication("identity_mismatch:5295"), false);
    // The blocking branch appends doctor detail after a further colon; that
    // detail must not be mistaken for the failing-part list.
    assert.equal(
      gateFailureMentionsCommunication("gate_not_ready:wallet:daemon_running"),
      false
    );
  });

  await test("end to end: the exact production reason plus 0.2.1 staleness now yields a PASS", () => {
    // Reproduces 2026-08-07 exactly: OKX published 0.2.1, the box was idle, the
    // gate-check completed in 14s and said not-ready on communication alone.
    const reason = "gate_not_ready:ready,communication";
    assert.equal(gateFailureMentionsCommunication(reason), true, "the guard must let this through");
    const outcome = classifyGateCheckOutcome({
      stdout: gateCheckNotReadyStdout(),
      durationMs: 14_251,
      expectedAgentId: AGENT,
      timeoutMs: DEFAULT_GATE_CHECK_LIMITS.timeoutMs,
      doctorStdout: doctorStdout([
        { id: "cli_version", status: "fail" },
        { id: "autostart", status: "fail" },
      ]),
    });
    assert.equal(outcome.kind, "passed");
    assert.ok(
      outcome.kind === "passed" && outcome.advisories?.length === 2,
      "both advisories must be named rather than hidden"
    );
  });

  // ------------------------------------------------------- Incident #23 ----
  console.log(" the gate-check bound and install I/O must not fight each other");

  /**
   * Measured on the production Machine with CPU deprioritisation already
   * confirmed live at nice 19: every gate-check during a cleanup attempt still
   * returned `timeout` at `durationMs:150241`, and with no persisted proof
   * after a reboot the agent reported `gateReason:"no_proof_yet"` and withheld
   * its heartbeat for eleven consecutive cycles with `daemonOk:true` and
   * `xmtpOk:true`.
   *
   * `nice` could not help: `gate-check` shells out to `okx-a2a doctor`, whose
   * cost is dominated by live NETWORK calls, and a concurrent `npm install`
   * saturates the same network. The contention is I/O, which `nice` does not
   * schedule.
   */
  await test("the gate-check bound exceeds the command's own measured worst case, so a slow-but-healthy run can finish", () => {
    const limits = DEFAULT_GATE_CHECK_LIMITS;
    assert.ok(
      limits.timeoutMs > 150_000,
      `the bound must exceed the 150s at which real runs were being abandoned, got ${limits.timeoutMs}`
    );
    // Still far inside the windows it has to fit within, or a slow check would
    // itself become the thing that expires the proof.
    assert.ok(limits.timeoutMs < limits.refreshMs, "a check must finish well inside one refresh interval");
    assert.ok(
      limits.timeoutMs * 3 < limits.freshnessMs,
      "several consecutive slow checks must still fit inside one freshness window"
    );
  });

  await test("a timeout is STILL inconclusive at the wider bound — availability is bought without weakening the online claim", () => {
    const outcome = classifyGateCheckOutcome({
      error: { code: "ETIMEDOUT", message: "timed out" },
      durationMs: DEFAULT_GATE_CHECK_LIMITS.timeoutMs,
      expectedAgentId: AGENT,
      timeoutMs: DEFAULT_GATE_CHECK_LIMITS.timeoutMs,
    });
    assert.equal(outcome.kind, "inconclusive");
    // And a genuinely broken gate still dies immediately, regardless of bound.
    const broken = classifyGateCheckOutcome({
      stdout: gateCheckNotReadyStdout(),
      durationMs: 5_000,
      expectedAgentId: AGENT,
      timeoutMs: DEFAULT_GATE_CHECK_LIMITS.timeoutMs,
      doctorStdout: doctorStdout([{ id: "daemon_running", status: "fail" }]),
    });
    assert.equal(broken.kind, "failed");
  });

  await test("every install path caps npm's socket concurrency, so it cannot starve the network gate-check depends on", () => {
    const install = fs.readFileSync(
      path.join(__dirname, "..", "src", "lib", "execution", "workspace-install.ts"),
      "utf8"
    );
    const adapter = fs.readFileSync(
      path.join(__dirname, "..", "src", "lib", "execution", "package-manager-adapter.ts"),
      "utf8"
    );
    assert.ok(/"--maxsockets"/.test(install), "workspace installs must pass --maxsockets");
    assert.ok(/NPM_CONFIG_MAXSOCKETS/.test(install), "workspace install env must cap sockets");
    assert.ok(
      /NPM_CONFIG_MAXSOCKETS/.test(adapter),
      "the verification install — the heaviest one — must cap sockets too"
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

  await test("one event that never settles cannot own the recovery loop — bounded, reported, and the loop continues", async () => {
    const { ledger } = freshLedger();
    const envelope = {
      agentId: AGENT,
      message: { source: "system", event: "job_accepted", jobId: FUNDED_JOB },
    };
    const logs: string[] = [];
    const startedAt = Date.now();

    // The deadline is INJECTED, not set through the environment. An env read at
    // module-load time depends on import order and module caching — the exact
    // brittleness that let this pass locally and hang for 45 minutes in CI.
    const results = await recoverPendingEvents(
      {
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
        // The first event never settles; the second completes normally.
        fetchInstruction: async () => {
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
      } as never,
      { eventTimeoutMs: 50 }
    );

    const elapsedMs = Date.now() - startedAt;
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

    /**
     * Incident #27 regression. This asserts the TEST is fast, never that
     * production is: the production default stays 2,400,000 ms and is asserted
     * separately below. A timeout test that waits a production deadline is how
     * CI ran 45 minutes and got cancelled.
     */
    assert.ok(
      elapsedMs < 5_000,
      `the deadline test must prove itself in milliseconds, took ${elapsedMs}ms`
    );
  });

  await test("the injected test deadline never leaks into the production default", async () => {
    const mod = await import("../src/lib/okx-runtime/system-event-reconciler");
    assert.equal(
      mod.PRODUCTION_EVENT_EXECUTION_TIMEOUT_MS,
      2_400_000,
      "production must keep its real bound regardless of what tests inject"
    );
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

  /**
   * === Incident #28 ===
   *
   * This test previously asserted the OPPOSITE — that a timed-out job released
   * the slot immediately, "so a wedged job cannot hold the machine's only heavy
   * slot forever". That assertion looked like safety and was in fact the bug:
   * it licensed a retry to start a second `npm install` while the first was
   * still running. Production showed the result directly —
   *
   *   pid=15134 nice=19 age=102s :: npm install
   *   pid=15214 nice=19 age=28s  :: npm install
   *
   * — two concurrent installs on a 2 GB / 1-vCPU box, gate-check unable to
   * finish inside 300s, and 125 consecutive withheld heartbeats.
   *
   * The corrected contract separates the caller's wait from the slot's life.
   */
  await test("HEAVY TIMEOUT: the caller is released at the bound but the SLOT is held until the work actually drains", async () => {
    resetHeavyJobLimiterForTests();
    let observed: AbortSignal | undefined;
    let finish: (() => void) | undefined;

    await assert.rejects(
      () =>
        runExclusiveHeavyJob(
          "cleanup_pr:wedged",
          (signal) => {
            observed = signal;
            // Still running after the caller gives up — exactly like an
            // `npm install` that has not yet hit its own 600s deadline.
            return new Promise<void>((resolve) => {
              finish = resolve;
            });
          },
          { timeoutMs: 20 }
        ),
      (err: unknown) => err instanceof HeavyJobRejected && err.code === "heavy_job_timeout"
    );

    assert.equal(observed?.aborted, true, "the pipeline must be told to stop");

    // THE REGRESSION: the machine is still busy, so the slot must still be taken.
    assert.equal(
      currentHeavyJob()?.label,
      "cleanup_pr:wedged",
      "the slot must stay held while the abandoned job's subprocesses are still consuming the machine"
    );
    assert.equal(currentHeavyJob()?.draining, true, "the held slot must report itself as draining");

    // A retry arriving on backoff must be refused rather than starting a
    // second install on top of the first.
    await assert.rejects(
      () => runExclusiveHeavyJob("cleanup_pr:retry", async () => "second install"),
      (err: unknown) =>
        err instanceof HeavyJobRejected &&
        err.code === "heavy_job_already_running" &&
        /draining/.test(err.message)
    );

    // Once the work genuinely ends, the slot frees itself — no deadlock.
    finish?.();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(currentHeavyJob(), undefined, "a drained slot must be released");
    assert.equal(await runExclusiveHeavyJob("cleanup_pr:next", async () => "ok"), "ok");
  });

  await test("a heavy job that rejects AFTER its caller gave up must not crash the runtime", async () => {
    resetHeavyJobLimiterForTests();
    let boom: ((e: Error) => void) | undefined;
    await assert.rejects(
      () =>
        runExclusiveHeavyJob(
          "cleanup_pr:late-throw",
          () =>
            new Promise<never>((_resolve, reject) => {
              boom = reject;
            }),
          { timeoutMs: 20 }
        ),
      (err: unknown) => err instanceof HeavyJobRejected && err.code === "heavy_job_timeout"
    );
    // The race already settled; this rejection has no caller left waiting on it.
    // It must be observed internally rather than becoming an unhandled rejection,
    // which under Node's default would terminate the seller runtime.
    boom?.(new Error("install died after abandonment"));
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(currentHeavyJob(), undefined, "the failed drain still releases the slot");
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
