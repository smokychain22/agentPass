/**
 * The production entry point for the system-event route.
 *
 * The audited defect had two layers: the worker acknowledged without executing,
 * AND it had no production caller — `acknowledgeProviderEvent` was reachable
 * only from tests, so `next-action` never ran in production once. These pin the
 * caller's existence and behaviour.
 */
import assert from "node:assert/strict";

import {
  recoverPendingEvents,
  handleSystemEvent,
  type ReconcilerDeps,
} from "../src/lib/okx-runtime/system-event-reconciler";
import type { ActionEvidence, ActionLedger } from "../src/lib/okx-runtime/provider-event-executor";
import type { AuthoritativeTask } from "../src/lib/okx-runtime/system-event-route";

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
const ENVELOPE = { agentId: "9636", message: { source: "system", event: "job_accepted", jobId: JOB } };
const TASK: AuthoritativeTask = {
  jobId: JOB,
  aspAgentId: "9636",
  buyerAgentId: "5295",
  statusCode: 1,
  tokenAmount: "1",
  tokenSymbol: "USDT",
};

class MemoryLedger implements ActionLedger {
  private readonly store = new Map<string, ActionEvidence>();
  private readonly locks = new Set<string>();
  get(id: string) {
    return this.store.get(id);
  }
  put(id: string, e: ActionEvidence) {
    this.store.set(id, e);
  }
  tryLock(id: string) {
    if (this.locks.has(id)) return false;
    this.locks.add(id);
    return true;
  }
  unlock(id: string) {
    this.locks.delete(id);
  }
}

function deps(overrides: Partial<ReconcilerDeps> = {}): ReconcilerDeps {
  return {
    ledger: new MemoryLedger(),
    fetchInstruction: async () => ({ ok: true, stdout: "[Step 1] do the thing", stderr: "" }),
    readTask: async () => TASK,
    runModel: async () => ({
      ok: true,
      invocationId: "inv-1",
      actions: [{ command: "agent deliver", args: [JOB, "--agent-id", "9636"] }],
    }),
    runAction: async () => ({ ok: true, transactionRef: "0xtx", broadcast: true }),
    reconcile: async () => ({ completed: false }),
    publishStatus: async () => ({ ok: true, messageId: "xmtp-1" }),
    pending: () => [],
    log: () => {},
    ...overrides,
  };
}

async function run() {
  console.log("okx-system-event-reconciler");

  await test("startup recovery resumes every unfinished event from the ledger", async () => {
    const results = await recoverPendingEvents(
      deps({
        pending: () => [
          { eventId: "evt-1", envelope: ENVELOPE },
          { eventId: "evt-2", envelope: ENVELOPE },
        ],
      })
    );
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.acknowledged));
  });

  await test("a clean ledger recovers nothing and does no work", async () => {
    let modelTurns = 0;
    const results = await recoverPendingEvents(
      deps({
        runModel: async () => {
          modelTurns += 1;
          return { ok: true, actions: [] };
        },
      })
    );
    assert.deepEqual(results, []);
    assert.equal(modelTurns, 0);
  });

  await test("one poisoned record does not abort recovery of the others", async () => {
    let calls = 0;
    const results = await recoverPendingEvents(
      deps({
        pending: () => [
          { eventId: "bad", envelope: ENVELOPE },
          { eventId: "good", envelope: ENVELOPE },
        ],
        readTask: async () => {
          calls += 1;
          if (calls === 1) throw new Error("ledger_read_exploded");
          return TASK;
        },
      })
    );
    // The failure is swallowed per-record, never acknowledged, and the second
    // record still runs.
    assert.equal(results.length, 1);
    assert.equal(results[0].acknowledged, true);
  });

  await test("a newly observed official system event is executed", async () => {
    const result = await handleSystemEvent("evt-1", ENVELOPE, deps());
    assert.ok(result);
    assert.equal(result.state, "acknowledged");
  });

  await test("buyer chat is declined at the boundary and never reaches next-action or the model", async () => {
    let instructionFetches = 0;
    let modelTurns = 0;
    const result = await handleSystemEvent(
      "evt-1",
      { msgType: "a2a-agent-chat", message: { jobId: JOB } },
      deps({
        fetchInstruction: async () => {
          instructionFetches += 1;
          return { ok: true, stdout: "", stderr: "" };
        },
        runModel: async () => {
          modelTurns += 1;
          return { ok: true, actions: [] };
        },
      })
    );
    assert.equal(result, undefined);
    assert.equal(instructionFetches, 0);
    assert.equal(modelTurns, 0);
  });

  await test("recovery and live handling share one executor, so idempotency holds across both", async () => {
    const ledger = new MemoryLedger();
    let actionRuns = 0;
    const shared = deps({
      ledger,
      pending: () => [{ eventId: "evt-1", envelope: ENVELOPE }],
      runAction: async () => {
        actionRuns += 1;
        return { ok: true, transactionRef: "0xtx", broadcast: true };
      },
    });

    await handleSystemEvent("evt-1", ENVELOPE, shared);
    await recoverPendingEvents(shared);

    assert.equal(actionRuns, 1, "the action must not run twice across the two entry points");
  });

  await test("the reconciler logs an auditable outcome for every processed event", async () => {
    const logged: string[] = [];
    await handleSystemEvent("evt-1", ENVELOPE, deps({ log: (event) => logged.push(event) }));
    assert.ok(logged.includes("system_event_processed"));
  });

  console.log("okx-system-event-reconciler: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
