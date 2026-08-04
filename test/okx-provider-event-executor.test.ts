/**
 * The corrected system-event execution path.
 *
 * The defect these pin: the previous worker ran `onchainos agent next-action`
 * and acknowledged the event whenever the CLI exited 0. next-action exiting 0
 * only means instructions were printed — nothing had executed them — so every
 * event was permanently marked done having accomplished nothing, and
 * acknowledge() then suppressed replay, losing the work silently.
 */
import assert from "node:assert/strict";

import {
  executeSystemEvent,
  instructionDigest,
  type ActionEvidence,
  type ActionLedger,
  type ExecuteDeps,
} from "../src/lib/okx-runtime/provider-event-executor";
import type { AuthoritativeTask, ProposedAction } from "../src/lib/okx-runtime/system-event-route";

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
const EVENT_ID = "evt-1";

const ENVELOPE = {
  agentId: "9636",
  message: { source: "system", event: "job_accepted", jobId: JOB },
};

const TASK: AuthoritativeTask = {
  jobId: JOB,
  aspAgentId: "9636",
  buyerAgentId: "5295",
  statusCode: 1,
  tokenAmount: "1",
  tokenSymbol: "USDT",
};

const DELIVER: ProposedAction = { command: "agent deliver", args: [JOB, "--agent-id", "9636"] };

class MemoryLedger implements ActionLedger {
  readonly writes: ActionEvidence[] = [];
  private readonly store = new Map<string, ActionEvidence>();
  private readonly locks = new Set<string>();

  get(eventId: string) {
    return this.store.get(eventId);
  }
  put(eventId: string, evidence: ActionEvidence) {
    this.store.set(eventId, evidence);
    this.writes.push(evidence);
  }
  tryLock(eventId: string) {
    if (this.locks.has(eventId)) return false;
    this.locks.add(eventId);
    return true;
  }
  unlock(eventId: string) {
    this.locks.delete(eventId);
  }
  forceLock(eventId: string) {
    this.locks.add(eventId);
  }
}

function deps(overrides: Partial<ExecuteDeps> = {}): ExecuteDeps {
  return {
    ledger: new MemoryLedger(),
    fetchInstruction: async () => ({ ok: true, stdout: "[Step 1] deliver the thing", stderr: "" }),
    readTask: async () => TASK,
    runModel: async () => ({ ok: true, invocationId: "inv-1", actions: [DELIVER] }),
    runAction: async () => ({ ok: true, transactionRef: "0xtx", broadcast: true }),
    reconcile: async () => ({ completed: false }),
    publishStatus: async () => ({ ok: true, messageId: "xmtp-1" }),
    ...overrides,
  };
}

async function run() {
  console.log("okx-provider-event-executor");

  await test("a clean next-action exit that executes nothing is NEVER acknowledged", async () => {
    const ledger = new MemoryLedger();
    const d = deps({
      ledger,
      // next-action succeeds, but the model proposes no action at all.
      runModel: async () => ({ ok: true, invocationId: "inv-1", actions: [] }),
    });
    const result = await executeSystemEvent(EVENT_ID, ENVELOPE, d);

    assert.equal(result.acknowledged, false, "must not acknowledge without execution");
    assert.notEqual(result.state, "action_confirmed");
    // The pivotal non-terminal state must have been recorded on the way through.
    assert.ok(ledger.writes.some((w) => w.state === "instruction_fetched"));
  });

  await test("instruction_fetched is recorded but is not a completion state", async () => {
    const ledger = new MemoryLedger();
    await executeSystemEvent(EVENT_ID, ENVELOPE, deps({ ledger }));
    const fetched = ledger.writes.find((w) => w.state === "instruction_fetched");
    assert.ok(fetched);
    assert.equal(fetched.instructionDigest, instructionDigest("[Step 1] deliver the thing"));
  });

  await test("a genuinely completed action is persisted BEFORE it is acknowledged", async () => {
    const ledger = new MemoryLedger();
    const result = await executeSystemEvent(EVENT_ID, ENVELOPE, deps({ ledger }));

    assert.equal(result.state, "acknowledged");
    assert.equal(result.acknowledged, true);

    // action_confirmed must be durable strictly before acknowledgement, so a
    // crash in between replays into the publication path, not the action path.
    const states = ledger.writes.map((w) => w.state);
    const confirmedAt = states.indexOf("action_confirmed");
    const acknowledgedAt = states.indexOf("acknowledged");
    assert.ok(confirmedAt >= 0, "action_confirmed must be persisted");
    assert.ok(confirmedAt < acknowledgedAt, "evidence must precede acknowledgement");
    assert.equal(ledger.writes[acknowledgedAt].transactionRef, "0xtx");
    assert.equal(ledger.writes[acknowledgedAt].xmtpMessageId, "xmtp-1");
  });

  await test("a failed XMTP publication leaves the event unacknowledged but does NOT repeat the action", async () => {
    const ledger = new MemoryLedger();
    let actionRuns = 0;
    const failing = deps({
      ledger,
      runAction: async () => {
        actionRuns += 1;
        return { ok: true, transactionRef: "0xtx", broadcast: true };
      },
      publishStatus: async () => ({ ok: false, error: "xmtp_down" }),
    });

    const first = await executeSystemEvent(EVENT_ID, ENVELOPE, failing);
    assert.equal(first.state, "response_pending");
    assert.equal(first.acknowledged, false);
    assert.equal(actionRuns, 1);

    // Replay after the transport recovers: publication retries, action does not.
    const recovered = deps({
      ledger,
      runAction: async () => {
        actionRuns += 1;
        return { ok: true, transactionRef: "0xtx", broadcast: true };
      },
      publishStatus: async () => ({ ok: true, messageId: "xmtp-2" }),
    });
    const second = await executeSystemEvent(EVENT_ID, ENVELOPE, recovered);

    assert.equal(actionRuns, 1, "the on-chain action must never run twice");
    assert.equal(second.state, "acknowledged");
    assert.equal(second.reason, "resumed_at_publication");
    assert.equal(second.evidence?.xmtpMessageId, "xmtp-2");
  });

  await test("a duplicate event does not execute twice", async () => {
    const ledger = new MemoryLedger();
    let actionRuns = 0;
    const d = deps({
      ledger,
      runAction: async () => {
        actionRuns += 1;
        return { ok: true, transactionRef: "0xtx", broadcast: true };
      },
    });

    await executeSystemEvent(EVENT_ID, ENVELOPE, d);
    const second = await executeSystemEvent(EVENT_ID, ENVELOPE, d);

    assert.equal(actionRuns, 1, "the action must run exactly once");
    assert.equal(second.reason, "already_completed");
    assert.equal(second.acknowledged, true);
  });

  await test("restart after broadcast reconciles instead of re-sending the transaction", async () => {
    const ledger = new MemoryLedger();
    ledger.put(EVENT_ID, { state: "action_broadcast", action: DELIVER, attempts: 1 });

    let actionRuns = 0;
    const result = await executeSystemEvent(
      EVENT_ID,
      ENVELOPE,
      deps({
        ledger,
        runAction: async () => {
          actionRuns += 1;
          return { ok: true, broadcast: true };
        },
        reconcile: async () => ({ completed: true, transactionRef: "0xexisting" }),
      })
    );

    assert.equal(actionRuns, 0, "must not rebroadcast");
    // Reconciliation adopts the existing transaction and then continues the
    // turn through publication rather than stopping at action_confirmed.
    assert.equal(result.state, "acknowledged");
    assert.equal(result.reason, "reconciled_existing_action");
    assert.equal(result.evidence?.transactionRef, "0xexisting");
  });

  await test("a broadcast whose outcome is unknown stays unacknowledged and reconcilable", async () => {
    const ledger = new MemoryLedger();
    const result = await executeSystemEvent(
      EVENT_ID,
      ENVELOPE,
      deps({
        ledger,
        runAction: async () => ({ ok: false, broadcast: true, transactionRef: "0xpending" }),
      })
    );

    assert.equal(result.state, "action_broadcast");
    assert.equal(result.acknowledged, false);
    assert.equal(ledger.get(EVENT_ID)?.transactionRef, "0xpending");
  });

  await test("a 429 model failure stays retryable and unacknowledged", async () => {
    const result = await executeSystemEvent(
      EVENT_ID,
      ENVELOPE,
      deps({ runModel: async () => ({ ok: false, status: 429, actions: [] }) })
    );
    assert.equal(result.state, "retryable_failure");
    assert.equal(result.acknowledged, false);
  });

  await test("an auth/quota model failure is terminal and honestly recorded, not looped", async () => {
    const result = await executeSystemEvent(
      EVENT_ID,
      ENVELOPE,
      deps({ runModel: async () => ({ ok: false, status: 403, actions: [] }) })
    );
    assert.equal(result.state, "terminal_failure");
    assert.match(result.reason, /model_turn_terminal/);
  });

  /**
   * The turn's own diagnosis must survive into the recorded reason.
   *
   * Recording only the retry CLASS hid a live production defect for the entire
   * life of job 0x22a2…: the turn reported a precise cause (an unparseable
   * repository URL) on every one of 15 attempts, across four separate event
   * lifetimes, and none of it reached the ledger or the logs. Every failure
   * read as an indistinguishable `internal_failure_retryable`.
   */
  await test("a retryable failure records the turn's OWN cause, not just the retry class", async () => {
    const result = await executeSystemEvent(
      EVENT_ID,
      ENVELOPE,
      deps({
        runModel: async () => ({
          ok: false,
          status: undefined,
          actions: [],
          error: "repository_url_unresolved",
        }),
      })
    );
    assert.equal(result.state, "retryable_failure");
    assert.match(
      result.reason,
      /repository_url_unresolved/,
      "the diagnosable cause must not be discarded"
    );
    assert.match(result.reason, /model_turn_retryable/, "and the retry class is still reported");
  });

  await test("a terminal failure records the turn's own cause too", async () => {
    const result = await executeSystemEvent(
      EVENT_ID,
      ENVELOPE,
      deps({
        runModel: async () => ({
          ok: false,
          status: 403,
          actions: [],
          error: "wakeup_redirect_loop",
        }),
      })
    );
    assert.equal(result.state, "terminal_failure");
    assert.match(result.reason, /wakeup_redirect_loop/);
  });

  await test("a turn that reports no cause still records a clean retry class", async () => {
    // No `error` field — the reason must stay readable, never "undefined".
    const result = await executeSystemEvent(
      EVENT_ID,
      ENVELOPE,
      deps({ runModel: async () => ({ ok: false, status: 429, actions: [] }) })
    );
    assert.equal(result.state, "retryable_failure");
    assert.doesNotMatch(result.reason, /undefined/);
  });

  await test("a model-proposed action outside the allowlist is refused and never run", async () => {
    let actionRuns = 0;
    const result = await executeSystemEvent(
      EVENT_ID,
      ENVELOPE,
      deps({
        runModel: async () => ({
          ok: true,
          actions: [{ command: "agent update", args: ["--agent-id", "9636"] }],
        }),
        runAction: async () => {
          actionRuns += 1;
          return { ok: true, broadcast: true };
        },
      })
    );

    assert.equal(actionRuns, 0, "a refused action must never reach the runner");
    assert.equal(result.state, "terminal_failure");
    assert.match(result.reason, /action_refused:command_not_allowlisted/);
  });

  await test("a model-proposed amount that is not authoritative is refused before execution", async () => {
    let actionRuns = 0;
    const result = await executeSystemEvent(
      EVENT_ID,
      ENVELOPE,
      deps({
        runModel: async () => ({
          ok: true,
          actions: [{ command: "agent deliver", args: [JOB, "--token-amount", "999"] }],
        }),
        runAction: async () => {
          actionRuns += 1;
          return { ok: true, broadcast: true };
        },
      })
    );
    assert.equal(actionRuns, 0);
    assert.match(result.reason, /token_amount_not_authoritative/);
  });

  await test("an action against a job this runtime does not provide is refused", async () => {
    const result = await executeSystemEvent(
      EVENT_ID,
      ENVELOPE,
      deps({ readTask: async () => ({ ...TASK, aspAgentId: "1791" }) })
    );
    assert.match(result.reason, /not_designated_provider/);
    assert.equal(result.state, "terminal_failure");
  });

  await test("buyer chat never reaches next-action or the model", async () => {
    let instructionFetches = 0;
    let modelTurns = 0;
    const result = await executeSystemEvent(
      EVENT_ID,
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

    assert.equal(instructionFetches, 0, "buyer chat must not invoke next-action");
    assert.equal(modelTurns, 0, "buyer chat must never reach the model");
    assert.match(result.reason, /not_a_system_event:buyer_chat/);
    assert.equal(result.acknowledged, false);
  });

  await test("two concurrent loops cannot execute the same event", async () => {
    const ledger = new MemoryLedger();
    ledger.forceLock(EVENT_ID);

    let actionRuns = 0;
    const result = await executeSystemEvent(
      EVENT_ID,
      ENVELOPE,
      deps({
        ledger,
        runAction: async () => {
          actionRuns += 1;
          return { ok: true, broadcast: true };
        },
      })
    );

    assert.equal(actionRuns, 0);
    assert.equal(result.reason, "locked_by_another_loop");
    assert.equal(result.acknowledged, false);
  });

  await test("a next-action failure is not acknowledged as done", async () => {
    const result = await executeSystemEvent(
      EVENT_ID,
      ENVELOPE,
      deps({ fetchInstruction: async () => ({ ok: false, stdout: "", stderr: "boom" }) })
    );
    assert.equal(result.acknowledged, false);
    assert.match(result.reason, /next_action_failed/);
  });

  console.log("okx-provider-event-executor: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
