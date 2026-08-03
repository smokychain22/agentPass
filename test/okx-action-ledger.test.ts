/**
 * The durable action ledger on the mounted volume.
 *
 * The property that matters most: a ledger that cannot be trusted must FAIL
 * CLOSED. "No record" reads as "never broadcast", which would licence a
 * duplicate on-chain action — so corruption must raise, never silently reset.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  FileActionLedger,
  LedgerCorruptionError,
  actionLedgerPath,
} from "../src/lib/okx-runtime/action-ledger";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const JOB = "0x38463285397e0844c7c01446bae2783ea3a8b00f45147768c31d97cb484ce8a6";

function freshLedger(): { ledger: FileActionLedger; file: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-ledger-"));
  const file = actionLedgerPath(dir);
  return { ledger: new FileActionLedger(file, "9636"), file, dir };
}

console.log("okx-action-ledger");

test("a record round-trips and survives being re-read from disk", () => {
  const { ledger, file } = freshLedger();
  ledger.put("evt-1", { state: "action_confirmed", jobId: JOB, semanticKey: "sk-1", transactionRef: "0xtx" });

  // A brand-new instance — proves durability, not in-memory state.
  const reopened = new FileActionLedger(file, "9636");
  const record = reopened.get("evt-1");
  assert.equal(record?.state, "action_confirmed");
  assert.equal(record?.transactionRef, "0xtx");
  assert.equal(record?.providerAgentId, "9636");
});

test("writes are atomic — no temp file is left behind", () => {
  const { ledger, dir } = freshLedger();
  ledger.put("evt-1", { state: "discovered", jobId: JOB });
  const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);
});

test("a malformed ledger FAILS CLOSED rather than reading as empty", () => {
  const { ledger, file } = freshLedger();
  ledger.put("evt-1", { state: "action_broadcast", jobId: JOB });
  fs.writeFileSync(file, "{ this is not json", "utf8");

  // Must throw. Returning {} here would report "never broadcast" and licence
  // a duplicate transaction.
  assert.throws(() => new FileActionLedger(file, "9636").get("evt-1"), LedgerCorruptionError);
});

test("a corrupt ledger is quarantined for inspection, never deleted", () => {
  const { ledger, file, dir } = freshLedger();
  ledger.put("evt-1", { state: "action_broadcast", jobId: JOB });
  fs.writeFileSync(file, "not json at all", "utf8");

  try {
    new FileActionLedger(file, "9636").get("evt-1");
    assert.fail("expected corruption to throw");
  } catch (err) {
    assert.ok(err instanceof LedgerCorruptionError);
  }
  assert.ok(
    fs.readdirSync(dir).some((f) => f.includes(".corrupt.")),
    "the corrupt file must be preserved for an operator"
  );
});

test("a ledger belonging to a different provider fails closed", () => {
  const { ledger, file } = freshLedger();
  ledger.put("evt-1", { state: "action_confirmed", jobId: JOB });
  assert.throws(() => new FileActionLedger(file, "1791").get("evt-1"), LedgerCorruptionError);
});

test("a ledger with the wrong shape fails closed", () => {
  const { file } = freshLedger();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 99, records: {} }), "utf8");
  assert.throws(() => new FileActionLedger(file, "9636").get("evt-1"), LedgerCorruptionError);
});

test("an absent ledger is empty — that is a genuinely fresh volume, not corruption", () => {
  const { ledger } = freshLedger();
  assert.equal(ledger.get("evt-1"), undefined);
  assert.deepEqual(ledger.pendingForRecovery(), []);
});

test("a lock is exclusive — a second holder cannot claim the same event", () => {
  const { ledger } = freshLedger();
  assert.equal(ledger.tryLock("evt-1"), true);
  const other = new FileActionLedger(actionLedgerPathOf(ledger), "9636");
  assert.equal(other.tryLock("evt-1"), false, "a live lock must not be stealable");
});

test("unlock releases the claim", () => {
  const { ledger, file } = freshLedger();
  assert.equal(ledger.tryLock("evt-1"), true);
  ledger.unlock("evt-1");
  assert.equal(new FileActionLedger(file, "9636").tryLock("evt-1"), true);
});

test("locks are per-event, not global", () => {
  const { ledger } = freshLedger();
  assert.equal(ledger.tryLock("evt-1"), true);
  assert.equal(ledger.tryLock("evt-2"), true);
});

test("duplicate semantic identity returns the existing record instead of a new execution", () => {
  const { ledger } = freshLedger();
  ledger.put("evt-1", { state: "acknowledged", jobId: JOB, semanticKey: "same-key", acknowledged: true });
  const found = ledger.findBySemanticKey("same-key");
  assert.equal(found?.eventId, "evt-1");
  assert.equal(found?.acknowledged, true);
});

test("restart recovery returns unfinished events and excludes finished ones", () => {
  const { ledger, file } = freshLedger();
  ledger.put("done", { state: "acknowledged", jobId: JOB, acknowledged: true });
  ledger.put("dead", { state: "terminal_failure", jobId: JOB });
  ledger.put("pending", { state: "action_broadcast", jobId: JOB });

  const recovered = new FileActionLedger(file, "9636").pendingForRecovery();
  assert.deepEqual(
    recovered.map((r) => r.eventId),
    ["pending"]
  );
});

test("an update preserves prior evidence rather than clobbering it", () => {
  const { ledger } = freshLedger();
  ledger.put("evt-1", { state: "action_confirmed", jobId: JOB, transactionRef: "0xtx" });
  ledger.put("evt-1", { state: "acknowledged", acknowledged: true, xmtpOutboundId: "m-1" });

  const record = ledger.get("evt-1");
  assert.equal(record?.transactionRef, "0xtx", "the transaction reference must survive the update");
  assert.equal(record?.state, "acknowledged");
  assert.equal(record?.xmtpOutboundId, "m-1");
});

// Regression: the merge originally spread `...existing` AFTER the computed
// fields, so a stale or hostile record could override providerAgentId and the
// ledger would then vouch for another agent's transaction history as its own.
test("providerAgentId is always the ledger owner and cannot be overridden by a patch", () => {
  const { ledger } = freshLedger();
  ledger.put("evt-1", {
    state: "action_confirmed",
    jobId: JOB,
    providerAgentId: "1791",
  } as never);
  assert.equal(ledger.get("evt-1")?.providerAgentId, "9636");
});

test("no credential-shaped material is ever persisted", () => {
  const { ledger, file } = freshLedger();
  ledger.put("evt-1", {
    state: "action_authorized",
    jobId: JOB,
    argv: ["agent", "deliver", JOB, "--agent-id", "9636"],
  });
  const raw = fs.readFileSync(file, "utf8");
  for (const forbidden of ["AIza", "api_key", "apiKey", "Authorization", "Bearer ", "sk-"]) {
    assert.ok(!raw.includes(forbidden), `ledger must not contain ${forbidden}`);
  }
});

console.log("okx-action-ledger: all passed");

/** Reads back the ledger's own file path for constructing a second instance. */
function actionLedgerPathOf(ledger: FileActionLedger): string {
  return (ledger as unknown as { file: string }).file;
}
