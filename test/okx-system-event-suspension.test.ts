/**
 * The operator kill switch for the autonomous system-event path.
 *
 * Pins the property that matters on a funded job: suspension is a PAUSE, never
 * a decision. Nothing may be acknowledged, delivered, settled, rejected or
 * retired while suspended, and every pending event must survive untouched.
 */
import assert from "node:assert/strict";

import {
  recoverPendingEvents,
  handleSystemEvent,
  type ReconcilerDeps,
} from "../src/lib/okx-runtime/system-event-reconciler";
import {
  systemEventsSuspended,
  SUSPEND_SYSTEM_EVENTS_ENV,
} from "../src/lib/okx-runtime/system-event-suspension";
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

/** The real funded job this switch was built to hold. */
const FUNDED_JOB = "0x22a216415e2b1176d2111b136584e42fd949f7c0cfca48c657a7d1ca8e6927c6";
const ENVELOPE = {
  agentId: "9636",
  message: { source: "system", event: "job_accepted", jobId: FUNDED_JOB },
};
const TASK: AuthoritativeTask = {
  jobId: FUNDED_JOB,
  aspAgentId: "9636",
  buyerAgentId: "10466",
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

/** Every side-effecting dep throws: reaching one at all is the failure. */
function strictDeps(overrides: Partial<ReconcilerDeps> = {}): ReconcilerDeps {
  return {
    ledger: new MemoryLedger(),
    fetchInstruction: async () => {
      throw new Error("fetchInstruction must not run while suspended");
    },
    readTask: async () => {
      throw new Error("readTask must not run while suspended");
    },
    runModel: async () => {
      throw new Error("runModel must not run while suspended");
    },
    runAction: async () => {
      throw new Error("runAction (deliver/settle) must not run while suspended");
    },
    reconcile: async () => {
      throw new Error("reconcile must not run while suspended");
    },
    publishStatus: async () => {
      throw new Error("publishStatus must not run while suspended");
    },
    pending: () => [],
    log: () => {},
    ...overrides,
  };
}

/** Minimal env object — this project's ProcessEnv declares NODE_ENV required. */
function env(value?: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ...(value === undefined ? {} : { [SUSPEND_SYSTEM_EVENTS_ENV]: value }),
  } as NodeJS.ProcessEnv;
}

async function withSuspendFlag<T>(
  value: string | undefined,
  fn: () => Promise<T> | T
): Promise<T> {
  const previous = process.env[SUSPEND_SYSTEM_EVENTS_ENV];
  if (value === undefined) delete process.env[SUSPEND_SYSTEM_EVENTS_ENV];
  else process.env[SUSPEND_SYSTEM_EVENTS_ENV] = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env[SUSPEND_SYSTEM_EVENTS_ENV];
    else process.env[SUSPEND_SYSTEM_EVENTS_ENV] = previous;
  }
}

async function run() {
  console.log("okx-system-event-suspension");

  await test("unset means NOT suspended — absence can never disable production", () => {
    assert.equal(systemEventsSuspended(env()), false);
    assert.equal(systemEventsSuspended(env("")), false);
    assert.equal(systemEventsSuspended(env("0")), false);
    assert.equal(systemEventsSuspended(env("false")), false);
    assert.equal(systemEventsSuspended(env("no")), false);
    assert.equal(systemEventsSuspended(env("maybe")), false);
  });

  await test("explicit truthy values engage suspension", () => {
    for (const value of ["1", "true", "TRUE", "yes", "on", " 1 "]) {
      assert.equal(
        systemEventsSuspended(env(value)),
        true,
        `expected ${JSON.stringify(value)} to suspend`
      );
    }
  });

  await test("startup recovery is skipped when suspended", async () => {
    await withSuspendFlag("1", async () => {
      const events: string[] = [];
      let pendingReads = 0;
      const results = await recoverPendingEvents(
        strictDeps({
          pending: () => {
            pendingReads += 1;
            return [{ eventId: "evt-1", envelope: ENVELOPE }];
          },
          log: (event) => events.push(event),
        })
      );

      assert.deepEqual(results, []);
      assert.ok(events.includes("system_events_suspended"), "must log system_events_suspended");
      assert.ok(!events.includes("system_event_recovery_start"), "must not start recovery");
      assert.ok(!events.includes("system_event_recovered"), "must not recover any event");
      assert.ok(!events.includes("system_event_recovery_complete"), "must not complete recovery");
      // The ledger is not even read: suspension cannot mutate retry metadata.
      assert.equal(pendingReads, 0, "pending() must not be read while suspended");
    });
  });

  await test("a pending funded-job event is left untouched and unacknowledged", async () => {
    await withSuspendFlag("1", async () => {
      const pending = [{ eventId: "evt-funded", envelope: ENVELOPE }];
      const snapshot = JSON.stringify(pending);
      const ledger = new MemoryLedger();

      await recoverPendingEvents(strictDeps({ ledger, pending: () => pending }));

      assert.equal(JSON.stringify(pending), snapshot, "pending events must be unchanged");
      assert.equal(ledger.get("evt-funded"), undefined, "no ledger record may be written");
    });
  });

  await test("handleSystemEvent refuses while suspended — no delivery or settlement", async () => {
    await withSuspendFlag("1", async () => {
      const events: string[] = [];
      const result = await handleSystemEvent(
        "evt-funded",
        ENVELOPE,
        strictDeps({ log: (event) => events.push(event) })
      );

      assert.equal(result, undefined, "must signal not-handled");
      assert.ok(events.includes("system_events_suspended"));
      assert.ok(!events.includes("system_event_processed"), "must not process the event");
    });
  });

  await test("normal behaviour is unchanged when the flag is absent", async () => {
    await withSuspendFlag(undefined, async () => {
      const events: string[] = [];
      const result = await handleSystemEvent("evt-1", ENVELOPE, {
        ...strictDeps(),
        fetchInstruction: async () => ({ ok: true, stdout: "[Step 1] do the thing", stderr: "" }),
        readTask: async () => TASK,
        runModel: async () => ({
          ok: true,
          invocationId: "inv-1",
          actions: [{ command: "agent deliver", args: [FUNDED_JOB, "--agent-id", "9636"] }],
        }),
        runAction: async () => ({ ok: true, transactionRef: "0xtx", broadcast: true }),
        reconcile: async () => ({ completed: false }),
        publishStatus: async () => ({ ok: true, messageId: "xmtp-1" }),
        log: (event) => events.push(event),
      });

      assert.ok(result, "event must be handled when not suspended");
      assert.ok(events.includes("system_event_processed"));
      assert.ok(!events.includes("system_events_suspended"));
    });
  });

  await test("recovery runs normally when the flag is absent", async () => {
    await withSuspendFlag(undefined, async () => {
      const events: string[] = [];
      let pendingReads = 0;
      await recoverPendingEvents({
        ...strictDeps(),
        pending: () => {
          pendingReads += 1;
          return [];
        },
        log: (event) => events.push(event),
      });

      assert.equal(pendingReads, 1, "pending() must be read when not suspended");
      assert.ok(events.includes("system_event_recovery_clean"));
      assert.ok(!events.includes("system_events_suspended"));
    });
  });

  await test("a falsy flag value does not suspend", async () => {
    await withSuspendFlag("0", async () => {
      const events: string[] = [];
      await recoverPendingEvents({
        ...strictDeps(),
        pending: () => [],
        log: (event) => events.push(event),
      });
      assert.ok(!events.includes("system_events_suspended"));
      assert.ok(events.includes("system_event_recovery_clean"));
    });
  });

  console.log("okx-system-event-suspension: all tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
