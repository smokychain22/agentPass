/**
 * Proof that the corrected executor is reached by the REAL production runtime.
 *
 * The audited defect was not only that the old worker acknowledged without
 * executing — it was that the executing code had no production caller at all.
 * A test that exercises the executor directly cannot detect that: it passes
 * just as happily when nothing in production ever calls it. So these tests go
 * through scripts/repodiet-seller-runtime.ts's own exported wiring, built by
 * the same function main() uses, with only the process seam replaced.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildSystemEventDeps, runSystemEventCycle } from "../scripts/repodiet-seller-runtime";
import type { ProcessRunResult } from "../src/lib/okx-runtime/process-runner";
import {
  OKX_SYSTEM_EVENT_AGENT_ID,
  OKX_SYSTEM_EVENT_MODEL,
} from "../src/lib/okx-runtime/system-event-agent";
import { spoolSystemEvent, systemEventInboxPath } from "../src/lib/okx-runtime/system-event-intake";
import {
  ALLOWED_COMMANDS,
  authorizeAction,
  type AuthoritativeTask,
} from "../src/lib/okx-runtime/system-event-route";

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const ROOT = process.cwd();
/** Deliberately minimal: the adapters must not depend on the ambient environment. */
const TEST_ENV: NodeJS.ProcessEnv = { NODE_ENV: "test" };
const JOB = "0x38463285397e0844c7c01446bae2783ea3a8b00f45147768c31d97cb484ce8a6";
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

const STATUS_STDOUT = [
  "Task status: accepted",
  `  jobId:  ${JOB}`,
  "  budget: 1 USDT",
  "  user: 5295",
  "  asp: 9636",
].join("\n");

const MODEL_STDOUT = JSON.stringify({
  runId: "run-1",
  repodietActions: [{ command: "agent deliver", args: [JOB, "--agent-id", "9636"] }],
});

interface Invocation {
  bin: string;
  argv: string[];
}

function ok(stdout: string): ProcessRunResult {
  return {
    ok: true,
    exitCode: 0,
    signal: null,
    stdout,
    stderr: "",
    timedOut: false,
    cancelled: false,
  };
}

/** Fake process seam. Records every argv it is given and answers plausibly. */
function recordingRunner(overrides: Record<string, ProcessRunResult> = {}) {
  const calls: Invocation[] = [];
  const runner = async (bin: string, argv: readonly string[]): Promise<ProcessRunResult> => {
    calls.push({ bin, argv: [...argv] });
    // Overrides may be keyed on the binary plus one or two leading subcommands
    // (`onchainos agent status`, `okx-a2a xmtp-send`), so try the longer key
    // first and fall back to the shorter one.
    for (const key of [`${bin} ${argv[0]} ${argv[1] ?? ""}`.trim(), `${bin} ${argv[0]}`.trim()]) {
      if (overrides[key]) return overrides[key];
    }
    if (bin === "onchainos" && argv[1] === "next-action") return ok("[Step 1] Deliver the result.");
    if (bin === "onchainos" && argv[1] === "status") return ok(STATUS_STDOUT);
    if (bin === "onchainos" && argv[1] === "deliver") return ok(`{"txHash":"0x${"a".repeat(64)}"}`);
    if (bin === "openclaw") return ok(MODEL_STDOUT);
    if (bin === "okx-a2a") return ok('{"messageId":"xmtp-1"}');
    return ok("");
  };
  return { calls, runner: runner as never };
}

function workspace(): { data: string; inbox: string } {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-wiring-"));
  const inbox = systemEventInboxPath(data);
  fs.mkdirSync(inbox, { recursive: true });
  return { data, inbox };
}

function ran(calls: Invocation[], bin: string, sub: string): Invocation[] {
  return calls.filter((c) => c.bin === bin && c.argv[1] === sub);
}

async function run() {
  console.log("seller-runtime-system-event-wiring");

  const source = fs.readFileSync(path.join(ROOT, "scripts/repodiet-seller-runtime.ts"), "utf8");

  await test("the production runtime calls recoverPendingEvents on startup", () => {
    // Static proof that the caller exists in main() itself, not merely that an
    // exported helper could call it — the absence of a production caller is the
    // exact defect being fixed.
    const main = source.slice(source.indexOf("async function main("));
    assert.ok(
      /await recoverPendingEvents\(systemEventDeps\)/.test(main),
      "main() must resume unfinished events from the durable ledger at startup"
    );
    assert.ok(
      main.indexOf("establishCommunicationReadiness()") <
        main.indexOf("recoverPendingEvents(systemEventDeps)"),
      "recovery must run only after communication readiness is established"
    );
  });

  await test("the runtime binds the ledger to the mounted volume's data directory", () => {
    assert.ok(/buildSystemEventDeps\(paths\.data\)/.test(source));
    assert.ok(/actionLedgerPath\(paths\.data\)/.test(source));
  });

  await test("the runtime does not drag the Gateway client into its startup path", () => {
    // scripts/seller-runtime-supervisor.ts reaches
    // `openclaw/plugin-sdk/gateway-runtime` through gateway-rpc-probe, whose
    // bundled undici calls `webidl.util.markAsUncloneable` — Node 22+ only.
    // Importing it here for two string constants crashed the Node 20 CI job
    // outright and coupled this process to the Gateway for no reason.
    assert.doesNotMatch(source, /from\s+["']\.\/seller-runtime-supervisor["']/);
    // Import specifiers only. The bare string "openclaw" is legitimate here —
    // it is the configured okx-a2a provider name, not a module.
    assert.doesNotMatch(source, /from\s+["']openclaw/);
    assert.doesNotMatch(source, /require\(\s*["']openclaw/);
    assert.ok(
      /from\s+["']\.\.\/src\/lib\/okx-runtime\/system-event-agent["']/.test(source),
      "the isolated agent id must come from the dependency-free module"
    );
  });

  await test("a newly received official event runs through the same executor", async () => {
    const { data, inbox } = workspace();
    const { calls, runner } = recordingRunner();
    const deps = buildSystemEventDeps(data, TEST_ENV, runner);

    spoolSystemEvent(inbox, ENVELOPE, "todo_1");
    await runSystemEventCycle(deps, inbox);

    // The full official sequence, through the real adapters.
    assert.equal(ran(calls, "onchainos", "next-action").length, 1);
    assert.equal(ran(calls, "onchainos", "deliver").length, 1);
    assert.equal(calls.filter((c) => c.bin === "openclaw").length, 1);
    assert.equal(calls.filter((c) => c.bin === "okx-a2a").length, 1);
    assert.equal(deps.ledgerFile.get("todo_1")?.state, "acknowledged");
    assert.equal(deps.ledgerFile.get("todo_1")?.acknowledged, true);
    // The spool file is consumed, and the ledger keeps the original envelope.
    assert.deepEqual(
      fs.readdirSync(inbox).filter((f) => f.endsWith(".json")),
      []
    );
    assert.deepEqual(deps.ledgerFile.get("todo_1")?.envelope, ENVELOPE);
  });

  await test("the model turn goes to the isolated agent, pinned to gemini-3.5-flash", async () => {
    const { data, inbox } = workspace();
    const { calls, runner } = recordingRunner();
    spoolSystemEvent(inbox, ENVELOPE, "todo_1");
    await runSystemEventCycle(buildSystemEventDeps(data, TEST_ENV, runner), inbox);

    const modelCall = calls.find((c) => c.bin === "openclaw");
    assert.ok(modelCall);
    const agentIndex = modelCall.argv.indexOf("--agent");
    assert.equal(modelCall.argv[agentIndex + 1], OKX_SYSTEM_EVENT_AGENT_ID);
    assert.equal(OKX_SYSTEM_EVENT_AGENT_ID, "okx-system-events");
    assert.equal(OKX_SYSTEM_EVENT_MODEL, "google/gemini-3.5-flash");
    assert.notEqual(OKX_SYSTEM_EVENT_MODEL, "google/gemini-2.5-flash");
  });

  await test("the global default model is never written by the seller runtime", () => {
    // The model is bound to the isolated agent alone. Nothing in this runtime
    // may set a global default — that is what would let ordinary buyer chat
    // reach Gemini.
    assert.doesNotMatch(source, /models\.default/);
    assert.doesNotMatch(source, /config\s+set/);
    assert.doesNotMatch(source, /gemini/i);
  });

  await test("ordinary buyer chat never reaches the system-event route", async () => {
    const { data, inbox } = workspace();
    const { calls, runner } = recordingRunner();
    const deps = buildSystemEventDeps(data, TEST_ENV, runner);

    spoolSystemEvent(
      inbox,
      { msgType: "a2a-agent-chat", jobId: JOB, sender: { role: "USER" } },
      "chat_1"
    );
    spoolSystemEvent(inbox, { agentId: "9636", message: { source: "user", text: "hi" } }, "chat_2");
    await runSystemEventCycle(deps, inbox);

    assert.deepEqual(calls, [], "no CLI, no next-action and no model turn for buyer chat");
    assert.equal(deps.ledgerFile.pendingForRecovery().length, 0);
    // Rejected envelopes are moved aside, never left to be retried forever.
    assert.equal(fs.readdirSync(path.join(inbox, "rejected")).length, 2);
  });

  await test("a restart after broadcast reconciles instead of rebroadcasting", async () => {
    const { data, inbox } = workspace();
    // Reconciliation evidence: the task has left `accepted`, so the deliver
    // that was in flight genuinely landed.
    const submitted = STATUS_STDOUT.replace("Task status: accepted", "Task status: submitted");
    const { calls, runner } = recordingRunner({ "onchainos agent status": ok(submitted) });
    const deps = buildSystemEventDeps(data, TEST_ENV, runner);

    // Exactly the record a crash between signing and confirmation leaves.
    deps.ledgerFile.put("todo_1", {
      state: "action_broadcast",
      semanticKey: "k",
      jobId: JOB,
      envelope: ENVELOPE,
      authorizedAction: { command: "agent deliver", args: [JOB, "--agent-id", "9636"] },
      attempts: 1,
    });

    await runSystemEventCycle(deps, inbox);

    assert.ok(
      ran(calls, "onchainos", "status").length >= 1,
      "must reconcile against authoritative state"
    );
    assert.equal(ran(calls, "onchainos", "deliver").length, 0, "must never re-broadcast the action");
    assert.equal(ran(calls, "onchainos", "next-action").length, 0);
    assert.equal(calls.filter((c) => c.bin === "openclaw").length, 0, "no second model turn");
    assert.equal(deps.ledgerFile.get("todo_1")?.state, "acknowledged");
  });

  await test("a restart after action confirmation retries only the XMTP publication", async () => {
    const { data, inbox } = workspace();
    const { calls, runner } = recordingRunner();
    const deps = buildSystemEventDeps(data, TEST_ENV, runner);

    // The action landed; the buyer was never told. Replay must resume at
    // publication, never at the action.
    deps.ledgerFile.put("todo_1", {
      state: "response_pending",
      semanticKey: "k",
      jobId: JOB,
      envelope: ENVELOPE,
      authorizedAction: { command: "agent deliver", args: [JOB, "--agent-id", "9636"] },
      transactionRef: `0x${"a".repeat(64)}`,
      attempts: 1,
    });

    await runSystemEventCycle(deps, inbox);

    assert.equal(ran(calls, "onchainos", "deliver").length, 0, "the action must not run twice");
    assert.equal(ran(calls, "onchainos", "next-action").length, 0);
    assert.equal(calls.filter((c) => c.bin === "openclaw").length, 0);
    assert.equal(calls.filter((c) => c.bin === "okx-a2a" && c.argv[0] === "xmtp-send").length, 1);
    assert.equal(deps.ledgerFile.get("todo_1")?.state, "acknowledged");
  });

  await test("a failed publication leaves the event replayable without repeating the action", async () => {
    const { data, inbox } = workspace();
    const failedSend: ProcessRunResult = { ...ok(""), ok: false, exitCode: 1, stderr: "xmtp down" };
    const { calls, runner } = recordingRunner({ "okx-a2a xmtp-send": failedSend });
    const deps = buildSystemEventDeps(data, TEST_ENV, runner);

    spoolSystemEvent(inbox, ENVELOPE, "todo_1");
    await runSystemEventCycle(deps, inbox);

    const record = deps.ledgerFile.get("todo_1");
    assert.equal(record?.state, "response_pending");
    assert.equal(
      record?.acknowledged,
      false,
      "nothing may be acknowledged before the buyer is told"
    );
    assert.equal(ran(calls, "onchainos", "deliver").length, 1, "the action ran exactly once");
  });

  await test("the provider route cannot complete, settle, resubmit or mutate a listing", () => {
    // These belong to the buyer or to agent registration. The seller runtime
    // must not be able to release its own escrow, close its own job, or
    // resubmit Agent 9636's listing — which is under review.
    for (const command of [
      "agent complete",
      "agent close",
      "agent confirm-accept",
      "agent reject",
      "agent create",
      "agent update",
      "agent activate",
      "agent upload",
      "agent create-task",
      "agent set-asp",
      "agent asp-claim-rewards",
    ]) {
      assert.equal(ALLOWED_COMMANDS.has(command), false, `${command} must not be allowlisted`);
      const verdict = authorizeAction({ command, args: [JOB] }, TASK, JOB);
      assert.equal(verdict.allowed, false);
      if (!verdict.allowed) assert.equal(verdict.reason, `command_not_allowlisted:${command}`);
    }
  });

  await test("an authorized action still cannot be redirected onto another job", () => {
    const other = "0xc1647299c08504e476d0262f260e454d7ff751ab88af26a9154e781726e0c6b6";
    const verdict = authorizeAction({ command: "agent deliver", args: [other] }, TASK, JOB);
    assert.equal(verdict.allowed, false);
    if (!verdict.allowed) assert.equal(verdict.reason, "argument_job_id_mismatch");

    // And never on a job this runtime is not the designated provider for —
    // which is what keeps it off reviewer-owned work.
    const reviewerOwned = authorizeAction(
      { command: "agent deliver", args: [JOB] },
      { ...TASK, aspAgentId: "8178" },
      JOB
    );
    assert.equal(reviewerOwned.allowed, false);
    if (!reviewerOwned.allowed) assert.equal(reviewerOwned.reason, "not_designated_provider");
  });

  console.log("seller-runtime-system-event-wiring: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
