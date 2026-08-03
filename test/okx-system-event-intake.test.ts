/**
 * The envelope trust boundary and the ledger/executor adapter.
 *
 * Two defects are pinned here. The first: a ledger record could not be resumed
 * after a restart at all, because the envelope `next-action` needs was never
 * stored — so recovery either guessed it or did nothing. The second, worse one:
 * a record whose envelope cannot be proven must not be able to execute OR to be
 * acknowledged, since acknowledging suppresses replay and would bury work that
 * never happened.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { actionLedgerPath, FileActionLedger } from "../src/lib/okx-runtime/action-ledger";
import {
  deriveEventId,
  LedgerActionStore,
  MAX_ENVELOPE_BYTES,
  pendingSystemEvents,
  readSystemEventInbox,
  registerObservedEvent,
  retireSpoolFile,
  semanticKeyFor,
  spoolSystemEvent,
  systemEventInboxPath,
  validateOfficialEnvelope,
} from "../src/lib/okx-runtime/system-event-intake";
import type { InboundEnvelope } from "../src/lib/okx-runtime/system-event-route";

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const JOB = "0x38463285397e0844c7c01446bae2783ea3a8b00f45147768c31d97cb484ce8a6";
const OTHER_JOB = "0xc1647299c08504e476d0262f260e454d7ff751ab88af26a9154e781726e0c6b6";
const ENVELOPE: InboundEnvelope = {
  agentId: "9636",
  message: { source: "system", event: "job_accepted", jobId: JOB },
};

function freshLedger(): { ledger: FileActionLedger; directory: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-intake-"));
  return { ledger: new FileActionLedger(actionLedgerPath(directory), "9636"), directory };
}

async function run() {
  console.log("okx-system-event-intake");

  await test("a genuine official envelope validates and yields its event and job", () => {
    const verdict = validateOfficialEnvelope(ENVELOPE);
    assert.equal(verdict.ok, true);
    if (!verdict.ok) return;
    assert.equal(verdict.event, "job_accepted");
    assert.equal(verdict.jobId, JOB);
  });

  await test("a missing or malformed envelope fails closed", () => {
    for (const [raw, expected] of [
      [undefined, "envelope_missing"],
      [null, "envelope_missing"],
      ["{}", "envelope_not_an_object"],
      [[], "envelope_not_an_object"],
    ] as Array<[unknown, string]>) {
      const verdict = validateOfficialEnvelope(raw);
      assert.equal(verdict.ok, false);
      if (!verdict.ok) assert.equal(verdict.reason, expected);
    }

    // Structurally present but not an official system event.
    const notSystem = validateOfficialEnvelope({
      agentId: "9636",
      message: { source: "user", event: "job_accepted", jobId: JOB },
    });
    assert.equal(notSystem.ok, false);
    if (!notSystem.ok) assert.match(notSystem.reason, /^envelope_not_official:/);
  });

  await test("an oversized envelope is refused before it can reach argv or a prompt", () => {
    const verdict = validateOfficialEnvelope({
      agentId: "9636",
      message: {
        source: "system",
        event: "job_accepted",
        jobId: JOB,
        padding: "x".repeat(MAX_ENVELOPE_BYTES),
      },
    });
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.match(verdict.reason, /^envelope_oversized:/);
  });

  await test("an envelope that is not provably ours is untrusted", () => {
    const absent = validateOfficialEnvelope({
      message: { source: "system", event: "job_accepted", jobId: JOB },
    });
    assert.equal(absent.ok, false);
    if (!absent.ok) assert.equal(absent.reason, "envelope_agent_id_absent");

    const elsewhere = validateOfficialEnvelope({
      agentId: "8178",
      message: { source: "system", event: "job_accepted", jobId: JOB },
    });
    assert.equal(elsewhere.ok, false);
    if (!elsewhere.ok) assert.equal(elsewhere.reason, "envelope_agent_id_not_seller");
  });

  await test("a stored envelope naming a different job than its record is untrusted", () => {
    const verdict = validateOfficialEnvelope(ENVELOPE, OTHER_JOB);
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.equal(verdict.reason, "envelope_job_id_mismatch");
  });

  await test("the validated envelope is persisted and reconstructed after a restart", () => {
    const { ledger, directory } = freshLedger();
    const outcome = registerObservedEvent(ledger, ENVELOPE, { transportId: "todo_1" });
    assert.equal(outcome.accepted, true);

    // A genuinely separate reader, as a restarted process would be.
    const reopened = new FileActionLedger(actionLedgerPath(directory), "9636");
    const pending = pendingSystemEvents(reopened);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].eventId, "todo_1");
    assert.deepEqual(pending[0].envelope, ENVELOPE);
  });

  await test("an old record with no trustworthy envelope can neither execute nor acknowledge", () => {
    const { ledger } = freshLedger();
    // Exactly what a record written before envelopes were stored looks like.
    ledger.put("legacy-1", {
      state: "retryable_failure",
      semanticKey: "legacy",
      jobId: JOB,
      attempts: 1,
    });
    // And one whose envelope is present but points at another job.
    ledger.put("tampered-1", {
      state: "retryable_failure",
      semanticKey: "tampered",
      jobId: JOB,
      envelope: { agentId: "9636", message: { source: "system", event: "x", jobId: OTHER_JOB } },
      attempts: 1,
    });

    const reasons: string[] = [];
    const pending = pendingSystemEvents(ledger, (_event, fields) =>
      reasons.push(String(fields.reason))
    );

    assert.deepEqual(pending, [], "an unprovable record must never be handed to the executor");
    assert.equal(reasons.length, 2);
    assert.ok(reasons.includes("envelope_missing"));
    assert.ok(reasons.includes("envelope_job_id_mismatch"));
    // Still unacknowledged and still on disk — never silently buried.
    assert.equal(ledger.get("legacy-1")?.acknowledged, false);
    assert.equal(ledger.pendingForRecovery().length, 2);
  });

  await test("intake refuses an envelope that fails validation and records nothing", () => {
    const { ledger } = freshLedger();
    const outcome = registerObservedEvent(ledger, { agentId: "9636", message: { source: "user" } });
    assert.equal(outcome.accepted, false);
    assert.equal(ledger.pendingForRecovery().length, 0);
  });

  await test("a redelivery of the same work is not executed a second time", () => {
    const { ledger } = freshLedger();
    const first = registerObservedEvent(ledger, ENVELOPE, { transportId: "todo_1" });
    assert.equal(first.accepted, true);
    if (!first.accepted) return;

    // Finish it, exactly as the executor would.
    ledger.put(first.eventId, { state: "acknowledged", acknowledged: true });

    // Same work, new transport id.
    const second = registerObservedEvent(ledger, ENVELOPE, { transportId: "todo_2" });
    assert.equal(second.accepted, false);
    if (!second.accepted) assert.equal(second.reason, "duplicate_semantic_key");
  });

  await test("re-registering a known event never rewinds its lifecycle", () => {
    const { ledger } = freshLedger();
    registerObservedEvent(ledger, ENVELOPE, { transportId: "todo_1" });
    ledger.put("todo_1", { state: "action_confirmed", transactionRef: "0xtx" });

    const again = registerObservedEvent(ledger, ENVELOPE, { transportId: "todo_1" });
    assert.equal(again.accepted, true);
    if (again.accepted) assert.equal(again.duplicate, true);
    const record = ledger.get("todo_1");
    assert.equal(record?.state, "action_confirmed");
    assert.equal(record?.transactionRef, "0xtx");
  });

  /**
   * Reproduced LIVE in production on 2026-08-03/04: a genuine paid A2A job
   * (0x22a216415e2b1176d2111b136584e42fd949f7c0cfca48c657a7d1ca8e6927c6) hit a
   * transient Gemini 503 outage, exhausted the retry budget with
   * model_turn_terminal:max_attempts_exhausted, and was marked terminal_failure
   * with NO action ever proposed, authorized, or broadcast. Re-arming the job
   * via `onchainos agent set-asp` (the official mechanism that re-triggers
   * job_asp_selected) produced a genuinely fresh delivery under the SAME
   * semantic key — and registerObservedEvent refused it as a permanent
   * duplicate, with no path back short of hand-editing the ledger. A
   * correctly-authorized, unfunded, harmless job would have been stuck forever
   * even though the underlying retry-budget defect was already fixed.
   */
  await test("a fresh delivery is accepted after a prior terminal failure that never proposed any action", () => {
    const { ledger } = freshLedger();
    const first = registerObservedEvent(ledger, ENVELOPE, { transportId: "todo_1" });
    assert.equal(first.accepted, true);
    if (!first.accepted) return;

    // Exactly what a retry-budget exhaustion leaves behind: terminal, but no
    // authorizedAction / proposedAction / transactionRef were ever set,
    // because the model turn itself never completed even once.
    ledger.put(first.eventId, {
      state: "terminal_failure",
      terminalReason: "model_turn_terminal:max_attempts_exhausted",
      attempts: 15,
    });

    const retried = registerObservedEvent(ledger, ENVELOPE, { transportId: "todo_2" });
    assert.equal(retried.accepted, true, "an actionless terminal failure must not permanently block a fresh delivery");
    if (retried.accepted) assert.equal(retried.duplicate, false, "must be a genuinely new record, not a replay of the dead one");
    assert.equal(ledger.get("todo_2")?.state, "discovered");
  });

  await test("a terminal failure that DID propose an action still permanently blocks a fresh delivery", () => {
    for (const patch of [
      { authorizedAction: { command: "agent deliver", args: ["0xjob"] } },
      { proposedAction: { command: "agent deliver", args: ["0xjob"] } },
      { transactionRef: "0xtx" },
    ] as const) {
      const { ledger } = freshLedger();
      const first = registerObservedEvent(ledger, ENVELOPE, { transportId: "todo_1" });
      assert.equal(first.accepted, true);
      if (!first.accepted) continue;

      ledger.put(first.eventId, {
        state: "terminal_failure",
        terminalReason: "action_refused:some_reason",
        attempts: 1,
        ...patch,
      });

      const retried = registerObservedEvent(ledger, ENVELOPE, { transportId: "todo_2" });
      assert.equal(
        retried.accepted,
        false,
        `evidence of a taken action (${Object.keys(patch)[0]}) must still block a fresh delivery`
      );
      if (!retried.accepted) assert.equal(retried.reason, "duplicate_semantic_key");
    }
  });

  await test("semantic identity is stable across deliveries and distinct per job", () => {
    assert.equal(semanticKeyFor("job_accepted", JOB), semanticKeyFor("job_accepted", JOB));
    assert.notEqual(semanticKeyFor("job_accepted", JOB), semanticKeyFor("job_accepted", OTHER_JOB));
    assert.notEqual(semanticKeyFor("job_accepted", JOB), semanticKeyFor("job_delivered", JOB));
    // No transport id: the envelope itself must still produce a stable id.
    assert.equal(deriveEventId(ENVELOPE), deriveEventId(ENVELOPE));
    assert.equal(deriveEventId(ENVELOPE, "todo_9"), "todo_9");
  });

  await test("the ledger adapter acknowledges only a genuinely acknowledged lifecycle", () => {
    const { ledger } = freshLedger();
    registerObservedEvent(ledger, ENVELOPE, { transportId: "todo_1" });
    const store = new LedgerActionStore(ledger);

    // Every non-final state leaves the record replayable.
    for (const state of [
      "instruction_fetched",
      "action_authorized",
      "action_broadcast",
      "action_confirmed",
      "response_pending",
    ] as const) {
      store.put("todo_1", { state, attempts: 1 });
      assert.equal(ledger.get("todo_1")?.acknowledged, false, `${state} must stay replayable`);
      assert.equal(pendingSystemEvents(ledger).length, 1);
    }

    store.put("todo_1", { state: "acknowledged", attempts: 1 });
    assert.equal(ledger.get("todo_1")?.acknowledged, true);
    assert.deepEqual(pendingSystemEvents(ledger), []);
  });

  await test("the ledger adapter carries prior evidence forward instead of erasing it", () => {
    const { ledger } = freshLedger();
    registerObservedEvent(ledger, ENVELOPE, { transportId: "todo_1" });
    const store = new LedgerActionStore(ledger);

    store.put("todo_1", {
      state: "action_confirmed",
      attempts: 1,
      transactionRef: "0xtx",
      action: { command: "agent deliver", args: [JOB] },
      instructionDigest: "digest-1",
    });
    // A later patch that names none of those fields must not wipe them — losing
    // a transactionRef would licence a duplicate on-chain action.
    store.put("todo_1", { state: "response_pending", attempts: 1 });

    const evidence = store.get("todo_1");
    assert.equal(evidence?.transactionRef, "0xtx");
    assert.equal(evidence?.instructionDigest, "digest-1");
    assert.deepEqual(evidence?.action, { command: "agent deliver", args: [JOB] });
    // And the envelope survives every one of those writes.
    assert.deepEqual(ledger.get("todo_1")?.envelope, ENVELOPE);
  });

  await test("the durable spool round-trips an envelope and retires the file", () => {
    const { directory } = freshLedger();
    const inbox = systemEventInboxPath(directory);
    spoolSystemEvent(inbox, ENVELOPE, "todo_1");

    const spooled = readSystemEventInbox(inbox);
    assert.equal(spooled.length, 1);
    assert.equal(spooled[0].transportId, "todo_1");
    assert.deepEqual(spooled[0].raw, ENVELOPE);

    retireSpoolFile(spooled[0].file, "accepted");
    assert.deepEqual(readSystemEventInbox(inbox), []);
  });

  await test("an unparseable spool file is surfaced, not silently skipped forever", () => {
    const { directory } = freshLedger();
    const inbox = systemEventInboxPath(directory);
    fs.mkdirSync(inbox, { recursive: true });
    fs.writeFileSync(path.join(inbox, "broken.json"), "{ not json", "utf8");

    const spooled = readSystemEventInbox(inbox);
    assert.equal(spooled.length, 1);
    assert.equal(spooled[0].raw, undefined);

    retireSpoolFile(spooled[0].file, "rejected");
    assert.deepEqual(readSystemEventInbox(inbox), []);
    assert.ok(fs.existsSync(path.join(inbox, "rejected", "broken.json")));
  });

  console.log("okx-system-event-intake: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
