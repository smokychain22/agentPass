/**
 * Real CLI-backed adapters.
 *
 * The property that matters: every adapter builds an argv ARRAY. The
 * authorization boundary approves specific argument values, and that approval
 * is only meaningful if those exact values reach execve rather than being
 * re-parsed by a shell.
 */
import assert from "node:assert/strict";

import {
  parseTaskStatus,
  parseProposedActions,
  resolveExecutable,
  createTaskReader,
  createInstructionFetcher,
  createModelTurn,
  createActionRunner,
  createReconciler,
} from "../src/lib/okx-runtime/system-event-adapters";
import type { ProcessRunResult } from "../src/lib/okx-runtime/process-runner";

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

// Verbatim from the real production CLI.
const REAL_STATUS = `Task status: accepted
  jobId:    ${JOB}
  title:    RepoDiet Verified Cleanup
  budget:   1 USDT
  user:    5295
  asp: 9636`;

function ok(stdout: string): ProcessRunResult {
  return { ok: true, exitCode: 0, signal: null, stdout, stderr: "", timedOut: false, cancelled: false };
}
function fail(over: Partial<ProcessRunResult> = {}): ProcessRunResult {
  return {
    ok: false,
    exitCode: 1,
    signal: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    cancelled: false,
    ...over,
  };
}

function recorder() {
  const calls: Array<{ bin: string; args: readonly string[] }> = [];
  const runner = (async (bin: string, args: readonly string[]) => {
    calls.push({ bin, args });
    return ok(REAL_STATUS);
  }) as never;
  return { calls, runner };
}

const OPTS = { agentId: "9636", systemEventAgentId: "okx-system-events" };

async function run() {
  console.log("okx-system-event-adapters");

  await test("the real `agent status` output parses into an authoritative task", () => {
    const task = parseTaskStatus(REAL_STATUS);
    assert.deepEqual(task, {
      jobId: JOB,
      aspAgentId: "9636",
      buyerAgentId: "5295",
      statusCode: 1,
      tokenAmount: "1",
      tokenSymbol: "USDT",
    });
  });

  await test("a half-parsed task returns undefined rather than a guess", () => {
    assert.equal(parseTaskStatus("Task status: accepted"), undefined);
    assert.equal(parseTaskStatus(""), undefined);
    assert.equal(parseTaskStatus("garbage"), undefined);
  });

  await test("terminal status names map to non-actionable codes", () => {
    for (const [name, code] of [
      ["submitted", 2],
      ["disputed", 4],
      ["expired", 7],
    ] as const) {
      const parsed = parseTaskStatus(REAL_STATUS.replace("accepted", name));
      assert.equal(parsed?.statusCode, code, name);
    }
  });

  await test("every adapter invokes an argv array, never a shell string", async () => {
    const { calls, runner } = recorder();
    await createTaskReader({ ...OPTS, runner }).call(null, JOB);
    await createInstructionFetcher({ ...OPTS, runner })({
      event: "job_accepted",
      jobId: JOB,
      envelope: { message: { source: "system", event: "job_accepted", jobId: JOB } },
    });
    await createModelTurn({ ...OPTS, runner })({ instruction: "do it", jobId: JOB });

    assert.equal(calls.length, 3);
    for (const call of calls) {
      assert.ok(Array.isArray(call.args), "args must be an array");
      assert.ok(
        call.args.every((a) => typeof a === "string"),
        "every argument must be a string"
      );
    }
  });

  await test("the model turn targets the isolated agent, never the main one", async () => {
    const { calls, runner } = recorder();
    await createModelTurn({ ...OPTS, runner })({ instruction: "do it", jobId: JOB });
    const args = calls[0].args;
    const agentIndex = args.indexOf("--agent");
    assert.ok(agentIndex >= 0, "--agent must be passed");
    assert.equal(args[agentIndex + 1], "okx-system-events");
    assert.ok(args.includes("--local"));
  });

  await test("next-action is always called as the seller ASP role", async () => {
    const { calls, runner } = recorder();
    await createInstructionFetcher({ ...OPTS, runner })({
      event: "job_accepted",
      jobId: JOB,
      envelope: { message: { source: "system", event: "job_accepted", jobId: JOB } },
    });
    const args = calls[0].args;
    assert.deepEqual(args.slice(0, 4), ["agent", "next-action", "--role", "asp"]);
    assert.equal(args[args.indexOf("--agentId") + 1], "9636");
  });

  await test("proposed actions are only accepted in a strict shape", () => {
    assert.deepEqual(
      parseProposedActions('{"repodietActions":[{"command":"agent deliver","args":["x"]}]}'),
      [{ command: "agent deliver", args: ["x"] }]
    );
    // Anything malformed yields nothing, which the executor treats as
    // "work not done" — retryable, never acknowledged as success.
    for (const junk of [
      "no actions here",
      '{"repodietActions": "not-an-array"}',
      '{"repodietActions":[{"command":123,"args":[]}]}',
      '{"repodietActions":[{"command":"x","args":[5]}]}',
      '{"repodietActions":[ broken',
    ]) {
      assert.deepEqual(parseProposedActions(junk), [], junk);
    }
  });

  // Regression: extraction originally used a non-greedy /\[[\s\S]*?\]/, which
  // stopped at the first `]` — the nested `args` array — truncating the JSON so
  // every real payload parsed to []. In production that reads as "the model
  // proposed no action", i.e. silent total failure of the route.
  await test("actions with nested arrays and multiple entries survive extraction", () => {
    const payload = JSON.stringify({
      repodietActions: [
        { command: "agent deliver", args: [JOB, "--agent-id", "9636"] },
        { command: "okx-a2a xmtp-send", args: ["--job-id", JOB, "--message", "done"] },
      ],
    });
    const actions = parseProposedActions(`noise before ${payload} noise after`);
    assert.equal(actions.length, 2);
    assert.deepEqual(actions[0].args, [JOB, "--agent-id", "9636"]);
    assert.equal(actions[1].command, "okx-a2a xmtp-send");
  });

  await test("a bracket inside a string literal does not terminate extraction early", () => {
    const payload = JSON.stringify({
      repodietActions: [{ command: "agent deliver", args: ["a ] bracket", 'quote " and \\ slash'] }],
    });
    const actions = parseProposedActions(payload);
    assert.equal(actions.length, 1);
    assert.deepEqual(actions[0].args, ["a ] bracket", 'quote " and \\ slash']);
  });

  await test("an allowlisted command resolves to the right binary and argv", () => {
    assert.deepEqual(resolveExecutable({ command: "agent deliver", args: [JOB] }), {
      bin: "onchainos",
      argv: ["deliver", JOB],
    });
    assert.deepEqual(resolveExecutable({ command: "okx-a2a xmtp-send", args: ["--job-id", JOB] }), {
      bin: "okx-a2a",
      argv: ["xmtp-send", "--job-id", JOB],
    });
  });

  // The dangerous case: a timed-out action may already be signed and in flight.
  await test("a timed-out action reports broadcast-unknown so it reconciles instead of re-sending", async () => {
    const runner = (async () => fail({ timedOut: true })) as never;
    const outcome = await createActionRunner({ ...OPTS, runner })({
      command: "agent deliver",
      args: [JOB],
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.broadcast, true, "must be treated as possibly in flight");
    assert.match(outcome.error ?? "", /outcome_unknown/);
  });

  await test("a cleanly refused action is NOT reported as broadcast", async () => {
    const runner = (async () => fail({ stderr: "validation failed" })) as never;
    const outcome = await createActionRunner({ ...OPTS, runner })({
      command: "agent deliver",
      args: [JOB],
    });
    assert.equal(outcome.broadcast, false, "a clean refusal is safe to retry");
  });

  await test("reconciliation confirms a deliver only once the task has left accepted", async () => {
    const submitted = (async () => ok(REAL_STATUS.replace("accepted", "submitted"))) as never;
    const stillAccepted = (async () => ok(REAL_STATUS)) as never;
    const action = { command: "agent deliver", args: [JOB] };

    assert.deepEqual(
      await createReconciler({ ...OPTS, runner: submitted })({ jobId: JOB, action }),
      { completed: true }
    );
    assert.deepEqual(
      await createReconciler({ ...OPTS, runner: stillAccepted })({ jobId: JOB, action }),
      { completed: false }
    );
  });

  await test("an unreadable task never reports an action as completed", async () => {
    const runner = (async () => fail()) as never;
    const outcome = await createReconciler({ ...OPTS, runner })({
      jobId: JOB,
      action: { command: "agent deliver", args: [JOB] },
    });
    assert.equal(outcome.completed, false);
  });

  console.log("okx-system-event-adapters: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
