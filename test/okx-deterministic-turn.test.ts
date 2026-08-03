/**
 * These tests are the direct evidence for the architecture fix: the mandatory
 * A2A protocol path (acknowledging a system event, applying, accepting,
 * delivering) must survive a total model-provider outage, because none of it
 * ever calls one. `createDeterministicTurn` is what replaced
 * `createModelTurn` (the Gemini adapter) at the seam in
 * `scripts/repodiet-seller-runtime.ts`.
 */
import assert from "node:assert/strict";
import { createDeterministicTurn } from "../src/lib/okx-runtime/deterministic-turn";
import type { AuthoritativeTask } from "../src/lib/okx-runtime/system-event-route";
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

const JOB = "0x22a216415e2b1176d2111b136584e42fd949f7c0cfca48c657a7d1ca8e6927c6";

const NOTIFY_ONLY_PLAYBOOK = `[Current state] job_asp_selected — designated by User Agent, but no specific \`serviceId\` was pinned. jobId=\`${JOB}\` agentId=9636

**Notify the user, then end the turn**:
\`\`\`bash
onchainos agent user-notify --content "<localized content shown below>"
\`\`\`
content:
[Designated Task — Skipped] Job ${JOB} — the User Agent designated you as the ASP without pinning a specific service.
`;

// provider_applied's playbook shares the same single-notify shape as
// job_asp_selected's skip case — a different event name, the identical
// "one bash block, one content block, end the turn" structure next-action
// produces for any purely informational notification.
const PROVIDER_APPLIED_PLAYBOOK = `[Current state] provider_applied — your application for job \`${JOB}\` is on-chain; awaiting the User Agent's acceptance.

**Notify the user, then end the turn**:
\`\`\`bash
onchainos agent user-notify --content "<localized content shown below>"
\`\`\`
content:
[Application Submitted] Job ${JOB} — your application is on-chain. Waiting for the User Agent to confirm acceptance.
`;

const JOB_ACCEPTED_PLAYBOOK = `[Current state] job_accepted (User Agent has confirmed the apply)

**Load task context first**:
\`\`\`bash
onchainos agent common context ${JOB} --role asp --agent-id 9636
\`\`\`

**Step 1 — Notify the user (apply accepted) via \`onchainos agent user-notify\`**:
\`\`\`bash
onchainos agent user-notify --content "<localized content shown below>"
\`\`\`
content:
    [Job Accepted] Job ${JOB} has been accepted.
    - Title: <title>
    - Negotiated price: <tokenAmount> <tokenSymbol>

**Step 2 — Autonomously execute the task and prepare the deliverable**:
Pick the right tool / capability for the task content to get the work done.

**Step 3 — Deliver**:
\`\`\`bash
onchainos agent deliver ${JOB} --file "<local file path>" --agent-id 9636
\`\`\`
`;

const TASK: AuthoritativeTask = {
  jobId: JOB,
  aspAgentId: "9636",
  buyerAgentId: "10466",
  statusCode: 1,
  tokenAmount: "1",
  tokenSymbol: "USDT",
};

function ok(stdout: string): ProcessRunResult {
  return { ok: true, exitCode: 0, signal: null, stdout, stderr: "", timedOut: false, cancelled: false };
}
function fail(): ProcessRunResult {
  return { ok: false, exitCode: 1, signal: null, stdout: "", stderr: "not bound", timedOut: false, cancelled: false };
}

async function run() {
  console.log("okx-deterministic-turn");

  await test("provider_applied progresses without a model — same deterministic notify path as job_asp_selected", async () => {
    const turn = createDeterministicTurn({
      agentId: "9636",
      runner: (async () => {
        throw new Error("must not shell out for a notify-only event");
      }) as never,
      readTask: async () => TASK,
      createCleanupPr: (async () => {
        throw new Error("must not touch the cleanup pipeline for a notify-only event");
      }) as never,
    });

    const result = await turn({ instruction: PROVIDER_APPLIED_PLAYBOOK, jobId: JOB });
    assert.equal(result.ok, true);
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].command, "agent user-notify");
    assert.match(result.actions[0].args[1], /Application Submitted/);
  });

  await test("a notify-only playbook produces exactly one user-notify action, no context lookup, no cleanup pipeline", async () => {
    let contextCalls = 0;
    let cleanupCalls = 0;
    const turn = createDeterministicTurn({
      agentId: "9636",
      runner: (async () => {
        contextCalls++;
        return ok("unused");
      }) as never,
      readTask: async () => TASK,
      createCleanupPr: (async () => {
        cleanupCalls++;
        throw new Error("must not be called for a notify-only event");
      }) as never,
    });

    const result = await turn({ instruction: NOTIFY_ONLY_PLAYBOOK, jobId: JOB });
    assert.equal(result.ok, true);
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].command, "agent user-notify");
    assert.match(result.actions[0].args[1], /Designated Task — Skipped/);
    assert.equal(contextCalls, 0, "notify-only must never shell out for common context");
    assert.equal(cleanupCalls, 0, "notify-only must never touch the cleanup pipeline");
  });

  await test("job_accepted runs the real cleanup pipeline and proposes notify + deliver with the real PR URL", async () => {
    const turn = createDeterministicTurn({
      agentId: "9636",
      runner: (async () =>
        ok("serviceParams: repository=https://github.com/velz-cmd/repodiet-e2e-test\ntitle: RepoDiet Verified Cleanup\n")) as never,
      readTask: async () => TASK,
      createCleanupPr: (async (input: { repoUrl: string }) => {
        assert.equal(input.repoUrl, "https://github.com/velz-cmd/repodiet-e2e-test");
        return {
          data: {
            pullRequest: { number: 7, url: "https://github.com/velz-cmd/repodiet-e2e-test/pull/7" },
            actionSummary: { safeCandidatesApplied: 1, filesDeleted: 0 },
            repo: { cleanupBranch: "repodiet/cleanup-x" },
          },
        };
      }) as never,
    });

    const result = await turn({ instruction: JOB_ACCEPTED_PLAYBOOK, jobId: JOB });
    assert.equal(result.ok, true);
    assert.equal(result.actions.length, 2);
    assert.equal(result.actions[0].command, "agent user-notify");
    assert.match(result.actions[0].args[1], /1 USDT/);
    assert.match(result.actions[0].args[1], /RepoDiet Verified Cleanup/);
    assert.equal(result.actions[1].command, "agent deliver");
    assert.equal(result.actions[1].args[0], JOB);
    const deliverText = result.actions[1].args[result.actions[1].args.indexOf("--deliverable-text") + 1];
    assert.match(deliverText, /repodiet-e2e-test\/pull\/7/);
  });

  await test("job_accepted fails safe (retryable, no fabricated action) when common context is unavailable", async () => {
    const turn = createDeterministicTurn({
      agentId: "9636",
      runner: (async () => fail()) as never,
      readTask: async () => TASK,
      createCleanupPr: (async () => {
        throw new Error("must not run without a resolved repository");
      }) as never,
    });

    const result = await turn({ instruction: JOB_ACCEPTED_PLAYBOOK, jobId: JOB });
    assert.equal(result.ok, false);
    assert.equal(result.status, undefined);
    assert.equal(result.actions.length, 0);
  });

  await test("job_accepted fails safe when the repository URL cannot be found — never guesses which repo to write to", async () => {
    const turn = createDeterministicTurn({
      agentId: "9636",
      runner: (async () => ok("no repository field anywhere in this output")) as never,
      readTask: async () => TASK,
      createCleanupPr: (async () => {
        throw new Error("must not run without a resolved repository");
      }) as never,
    });

    const result = await turn({ instruction: JOB_ACCEPTED_PLAYBOOK, jobId: JOB });
    assert.equal(result.ok, false);
    assert.equal(result.error, "repository_url_unresolved");
  });

  await test("an unrecognized playbook shape stays retryable — never acknowledged as done, never a guessed action", async () => {
    const turn = createDeterministicTurn({
      agentId: "9636",
      runner: (async () => ok("unused")) as never,
      readTask: async () => TASK,
    });

    const result = await turn({ instruction: "A brand new event type the parser has never seen.", jobId: JOB });
    assert.equal(result.ok, false);
    assert.equal(result.status, undefined);
    assert.equal(result.error, "next_action_playbook_unrecognized");
  });

  await test("a Gemini/model-provider outage cannot stop event acknowledgement — no model call exists on this path", async () => {
    // The turn's dependency surface (runner, readTask, createCleanupPr) contains
    // nothing resembling a model provider call — this test documents that
    // invariant so a future change that reintroduces one fails loudly here.
    const turn = createDeterministicTurn({
      agentId: "9636",
      runner: (async () => ok("repository=https://github.com/velz-cmd/repodiet-e2e-test")) as never,
      readTask: async () => TASK,
      createCleanupPr: (async () => ({
        data: {
          pullRequest: { number: 1, url: "https://github.com/velz-cmd/repodiet-e2e-test/pull/1" },
          actionSummary: {},
          repo: { cleanupBranch: "repodiet/cleanup-y" },
        },
      })) as never,
    });

    const result = await turn({ instruction: JOB_ACCEPTED_PLAYBOOK, jobId: JOB });
    assert.equal(result.ok, true, "job_accepted must complete with zero model-provider dependency");
  });

  console.log("okx-deterministic-turn: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
