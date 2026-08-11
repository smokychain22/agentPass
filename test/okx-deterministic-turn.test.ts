/**
 * These tests are the direct evidence for the architecture fix: the mandatory
 * A2A protocol path (acknowledging a system event, applying, accepting,
 * delivering) must survive a total model-provider outage, because none of it
 * ever calls one. `createDeterministicTurn` is what replaced
 * `createModelTurn` (the Gemini adapter) at the seam in
 * `scripts/repodiet-seller-runtime.ts`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanupBranchForJob, createDeterministicTurn } from "../src/lib/okx-runtime/deterministic-turn";
import type { AuthoritativeTask } from "../src/lib/okx-runtime/system-event-route";
import type { ProcessRunResult } from "../src/lib/okx-runtime/process-runner";
import { ToolExecutionError } from "../src/lib/a2mcp/errors";
import {
  getDeleteApprovalRequest,
  recordDeleteApprovalReply,
} from "../src/lib/okx-runtime/buyer-delete-approval-requests";

function withIsolatedApprovalStore<T>(fn: () => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repodiet-deterministic-turn-approvals-"));
  const prev = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

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

/**
 * The real `wakeup_notify` playbook, copied verbatim from
 * `onchainos agent next-action --role asp` on repodiet-agent-9636 against the
 * live envelope for job 0x22a2…. It is a redirect, not an instruction.
 */
const WAKEUP_REDIRECT_PLAYBOOK = `[System notification] wakeup_notify (task wake-up after network / machine reboot)
[Role] ASP (Agent Service ASP)

⚠️ This is a wake-up heartbeat event, **NOT** a business-driving event. The real business state is in the envelope.message.jobStatus field.
You should NOT use \`wakeup_notify\` as --event to run the script — this script is just for guidance.

[Your next action (strict order)]

**Step 1 — Read the real status from the envelope**:
From the wakeup_notify envelope that triggered this turn, read the \`message.jobStatus\` field (e.g. \`accepted\` / \`submitted\` / \`rejected\` / \`disputed\` / \`completed\` / \`failed\`, etc. — the real status string).

**Step 2 — Use the real status to call next-action and fetch the current script**:
\`\`\`bash
onchainos agent next-action --role asp --agentId 9636 --message '{"event":"<value of the message.jobStatus field>","jobId":"${JOB}"}'
\`\`\`
Follow the returned script for what to do in the current status.
`;

/** Fake GitHub seams — production resolves a real token and hits the real API. */
function fakeGitHub(
  existingPulls: Array<{ number: number; url: string; head: string }> = [],
  baseCommit = "b890ac4b055e608a7729d442c92bfe1dce573e64"
) {
  const listCalls: Array<{ owner: string; repo: string; prefix: string }> = [];
  return {
    resolveGitHubToken: (async () => "fake-token") as never,
    createGitHubClient: (() => ({
      listOpenPullRequestsForHeadPrefix: async (owner: string, repo: string, prefix: string) => {
        listCalls.push({ owner, repo, prefix });
        return existingPulls;
      },
      // The per-job delete approval is bound to the base commit, so the turn
      // READS it rather than assuming it — see job-delivery-approvals.ts.
      getRepo: async (owner: string, repo: string) => ({
        owner,
        name: repo,
        defaultBranch: "main",
      }),
      getBranchSha: async () => baseCommit,
    })) as never,
    listCalls,
  };
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
    const github = fakeGitHub([]);
    let createPrCalls = 0;
    const turn = createDeterministicTurn({
      agentId: "9636",
      runner: (async () =>
        ok("serviceParams: repository=https://github.com/velz-cmd/repodiet-e2e-test\ntitle: RepoDiet Verified Cleanup\n")) as never,
      readTask: async () => TASK,
      createCleanupPr: (async (input: { repoUrl: string; cleanupBranch?: string }) => {
        createPrCalls++;
        assert.equal(input.repoUrl, "https://github.com/velz-cmd/repodiet-e2e-test");
        assert.match(input.cleanupBranch ?? "", /^repodiet\/cleanup-okx-22a2/, "must use the deterministic per-job branch name");
        return {
          data: {
            pullRequest: { number: 7, url: "https://github.com/velz-cmd/repodiet-e2e-test/pull/7" },
            actionSummary: { safeCandidatesApplied: 1, filesDeleted: 0 },
            repo: { cleanupBranch: "repodiet/cleanup-x" },
          },
        };
      }) as never,
      resolveGitHubToken: github.resolveGitHubToken,
      createGitHubClient: github.createGitHubClient,
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
    assert.equal(createPrCalls, 1);
    assert.equal(github.listCalls.length, 1, "must check for an existing PR before creating one");
  });

  await test("passes exactly one job-bound approved delete path into the cleanup pipeline", async () => {
    const github = fakeGitHub([]);
    let seenApproved: string[] | undefined;
    let calls = 0;
    const turn = createDeterministicTurn({
      agentId: "9636",
      runner: (async () =>
        ok("serviceParams: repository=https://github.com/velz-cmd/repodiet-e2e-test\n")) as never,
      readTask: async () => TASK,
      createCleanupPr: (async (input: { approvedPaths?: string[] }) => {
        calls++;
        seenApproved = input.approvedPaths;
        return {
          data: {
            pullRequest: { number: 9, url: "https://github.com/velz-cmd/repodiet-e2e-test/pull/9" },
            actionSummary: { safeCandidatesApplied: 1, filesDeleted: 1 },
            repo: { cleanupBranch: cleanupBranchForJob(JOB) },
          },
        };
      }) as never,
      resolveGitHubToken: github.resolveGitHubToken,
      createGitHubClient: github.createGitHubClient,
    });

    const result = await turn({ instruction: JOB_ACCEPTED_PLAYBOOK, jobId: JOB });
    assert.equal(result.ok, true);
    assert.equal(calls, 1);
    assert.deepEqual(
      seenApproved,
      ["src/unused/empty-module.ts"],
      "exactly one approved deletion, and only the reviewed path"
    );
  });

  await test("omits approvedPaths entirely when the base commit has moved", async () => {
    // A moved base branch means the reviewed diff no longer describes reality,
    // so the approval must expire rather than carry over to new content.
    const github = fakeGitHub([], "0000000000000000000000000000000000000000");
    let seenApproved: string[] | undefined = ["sentinel"];
    const turn = createDeterministicTurn({
      agentId: "9636",
      runner: (async () =>
        ok("serviceParams: repository=https://github.com/velz-cmd/repodiet-e2e-test\n")) as never,
      readTask: async () => TASK,
      createCleanupPr: (async (input: { approvedPaths?: string[] }) => {
        seenApproved = input.approvedPaths;
        return {
          data: {
            pullRequest: { number: 10, url: "https://github.com/velz-cmd/repodiet-e2e-test/pull/10" },
            actionSummary: { safeCandidatesApplied: 0, filesDeleted: 0 },
            repo: { cleanupBranch: cleanupBranchForJob(JOB) },
          },
        };
      }) as never,
      resolveGitHubToken: github.resolveGitHubToken,
      createGitHubClient: github.createGitHubClient,
    });

    await turn({ instruction: JOB_ACCEPTED_PLAYBOOK, jobId: JOB });
    assert.equal(seenApproved, undefined, "no approval must be supplied at an unreviewed commit");
  });

  await test("a different job id gets no approval — approval never leaks across jobs", async () => {
    const github = fakeGitHub([]);
    let seenApproved: string[] | undefined = ["sentinel"];
    const otherJob = "0x38463285397e0844c7c01446bae2783ea3a8b00f45147768c31d97cb484ce8a6";
    const turn = createDeterministicTurn({
      agentId: "9636",
      runner: (async () =>
        ok("serviceParams: repository=https://github.com/velz-cmd/repodiet-e2e-test\n")) as never,
      readTask: async () => TASK,
      createCleanupPr: (async (input: { approvedPaths?: string[] }) => {
        seenApproved = input.approvedPaths;
        return {
          data: {
            pullRequest: { number: 11, url: "https://github.com/velz-cmd/repodiet-e2e-test/pull/11" },
            actionSummary: { safeCandidatesApplied: 0, filesDeleted: 0 },
            repo: { cleanupBranch: cleanupBranchForJob(otherJob) },
          },
        };
      }) as never,
      resolveGitHubToken: github.resolveGitHubToken,
      createGitHubClient: github.createGitHubClient,
    });

    await turn({ instruction: JOB_ACCEPTED_PLAYBOOK, jobId: otherJob });
    assert.equal(seenApproved, undefined, "another job must not inherit this job's approval");
  });

  await test("a retry after a prior attempt already created the PR reuses it — never opens a duplicate", async () => {
    const github = fakeGitHub([
      { number: 3, url: "https://github.com/velz-cmd/repodiet-e2e-test/pull/3", head: cleanupBranchForJob(JOB) },
    ]);
    const turn = createDeterministicTurn({
      agentId: "9636",
      runner: (async () => ok("serviceParams: repository=https://github.com/velz-cmd/repodiet-e2e-test\n")) as never,
      readTask: async () => TASK,
      createCleanupPr: (async () => {
        throw new Error("must not create a second PR when one already exists for this job");
      }) as never,
      resolveGitHubToken: github.resolveGitHubToken,
      createGitHubClient: github.createGitHubClient,
    });

    const result = await turn({ instruction: JOB_ACCEPTED_PLAYBOOK, jobId: JOB });
    assert.equal(result.ok, true);
    const deliverAction = result.actions.find((a) => a.command === "agent deliver");
    assert.ok(deliverAction);
    const deliverText = deliverAction!.args[deliverAction!.args.indexOf("--deliverable-text") + 1];
    assert.match(deliverText, /pull\/3/, "must reference the pre-existing PR, not a fabricated new one");
  });

  // --- Buyer-in-the-loop delivery approval (NO_SAFE_CANDIDATES) -------------
  //
  // Job 0xba4de4f576f0dbb05b0a88d2d889102dfb134f5e1c901bf0534312daf5d33402's
  // 1 USDT escrow was stranded because a NO_SAFE_CANDIDATES failure used to
  // just fail and wait for a developer to hand-review and hardcode an entry
  // in job-delivery-approvals.ts — no self-sufficient path existed. These
  // tests are the direct evidence for the fix: RepoDiet now asks the buyer
  // itself, over the same A2A channel it already uses, and completes
  // delivery automatically once they reply — no code change, no Claude
  // Code, no manual step for a future job that hits this same gate.

  const NO_APPROVAL_JOB = "0xbuyer-approval-test-job";
  const NO_APPROVAL_COMMIT = "no-static-approval-for-this-commit";

  function noSafeCandidatesError(paths: string[]) {
    return new ToolExecutionError(
      "NO_SAFE_CANDIDATES",
      `No approved cleanup operation passed the final delivery safety gate. Blocked paths: ${paths.join(", ")}`,
      422,
      { skippedDeletePaths: paths }
    );
  }

  await test("NO_SAFE_CANDIDATES with real blocked paths and no existing approval asks the buyer instead of just failing", async () => {
    await withIsolatedApprovalStore(async () => {
      const github = fakeGitHub([], NO_APPROVAL_COMMIT);
      const turn = createDeterministicTurn({
        agentId: "9636",
        runner: (async () =>
          ok("serviceParams: repository=https://github.com/velz-cmd/repodiet-e2e-test\n")) as never,
        readTask: async () => ({ ...TASK, jobId: NO_APPROVAL_JOB }),
        createCleanupPr: (async () => {
          throw noSafeCandidatesError(["src/unused/leftover.ts", "src/lib/orphan-b.ts"]);
        }) as never,
        resolveGitHubToken: github.resolveGitHubToken,
        createGitHubClient: github.createGitHubClient,
      });

      const result = await turn({ instruction: JOB_ACCEPTED_PLAYBOOK, jobId: NO_APPROVAL_JOB });
      assert.equal(result.ok, true, "asking the buyer is real, useful work — not a failure");
      assert.equal(result.actions.length, 1);
      assert.equal(result.actions[0].command, "agent user-notify");
      assert.match(result.actions[0].args[1], /src\/unused\/leftover\.ts/);
      assert.match(result.actions[0].args[1], /src\/lib\/orphan-b\.ts/);
      assert.match(result.actions[0].args[1], /approve/i);

      const request = getDeleteApprovalRequest(NO_APPROVAL_JOB);
      assert.ok(request, "a pending request must be persisted so the buyer's later reply can be matched back");
      assert.equal(request!.status, "pending");
      assert.deepEqual(request!.requestedPaths, ["src/unused/leftover.ts", "src/lib/orphan-b.ts"]);
      assert.equal(request!.baseCommit, NO_APPROVAL_COMMIT);
    });
  });

  await test("a retry with the SAME blocked paths does not re-ask — no spamming the buyer every poll cycle", async () => {
    await withIsolatedApprovalStore(async () => {
      const github = fakeGitHub([], NO_APPROVAL_COMMIT);
      const turn = createDeterministicTurn({
        agentId: "9636",
        runner: (async () =>
          ok("serviceParams: repository=https://github.com/velz-cmd/repodiet-e2e-test\n")) as never,
        readTask: async () => ({ ...TASK, jobId: NO_APPROVAL_JOB }),
        createCleanupPr: (async () => {
          throw noSafeCandidatesError(["src/unused/leftover.ts"]);
        }) as never,
        resolveGitHubToken: github.resolveGitHubToken,
        createGitHubClient: github.createGitHubClient,
      });

      const first = await turn({ instruction: JOB_ACCEPTED_PLAYBOOK, jobId: NO_APPROVAL_JOB });
      assert.equal(first.ok, true);
      assert.equal(first.actions[0].command, "agent user-notify");

      const second = await turn({ instruction: JOB_ACCEPTED_PLAYBOOK, jobId: NO_APPROVAL_JOB });
      assert.equal(second.ok, false, "the second attempt still has not been delivered — must not fabricate success");
      assert.match(second.error ?? "", /NO_SAFE_CANDIDATES/);
      assert.equal(
        (second as { actions: unknown[] }).actions.length,
        0,
        "must NOT send a second identical approval request"
      );
    });
  });

  await test("once the buyer approves via the dynamic store, the next retry completes delivery automatically", async () => {
    await withIsolatedApprovalStore(async () => {
      const github = fakeGitHub([], NO_APPROVAL_COMMIT);
      let createPrCalls = 0;
      const turn = createDeterministicTurn({
        agentId: "9636",
        runner: (async () =>
          ok("serviceParams: repository=https://github.com/velz-cmd/repodiet-e2e-test\n")) as never,
        readTask: async () => ({ ...TASK, jobId: NO_APPROVAL_JOB }),
        createCleanupPr: (async (input: { approvedPaths?: string[] }) => {
          createPrCalls++;
          if (!input.approvedPaths || input.approvedPaths.length === 0) {
            throw noSafeCandidatesError(["src/unused/leftover.ts"]);
          }
          return {
            data: {
              pullRequest: {
                number: 42,
                url: "https://github.com/velz-cmd/repodiet-e2e-test/pull/42",
              },
              actionSummary: { safeCandidatesApplied: 1, filesDeleted: 1 },
              repo: { cleanupBranch: cleanupBranchForJob(NO_APPROVAL_JOB) },
            },
          };
        }) as never,
        resolveGitHubToken: github.resolveGitHubToken,
        createGitHubClient: github.createGitHubClient,
      });

      const first = await turn({ instruction: JOB_ACCEPTED_PLAYBOOK, jobId: NO_APPROVAL_JOB });
      assert.equal(first.ok, true);
      assert.equal(first.actions[0].command, "agent user-notify");
      assert.equal(createPrCalls, 1);

      // Simulate exactly what openclaw-plugins/repodiet-a2a-bridge does when
      // the buyer replies "approve" — a separate process, same shared file.
      const recorded = recordDeleteApprovalReply(NO_APPROVAL_JOB, { approved: true });
      assert.equal(recorded?.status, "approved");

      const second = await turn({ instruction: JOB_ACCEPTED_PLAYBOOK, jobId: NO_APPROVAL_JOB });
      assert.equal(second.ok, true, "delivery must now proceed with no further code change or manual step");
      assert.equal(createPrCalls, 2);
      const deliverAction = second.actions.find((a) => a.command === "agent deliver");
      assert.ok(deliverAction);
      const deliverText = deliverAction!.args[deliverAction!.args.indexOf("--deliverable-text") + 1];
      assert.match(deliverText, /pull\/42/);
    });
  });

  await test("cleanupBranchForJob is deterministic and stable for the same job across calls", () => {
    assert.equal(cleanupBranchForJob(JOB), cleanupBranchForJob(JOB));
    assert.match(cleanupBranchForJob(JOB), /^repodiet\/cleanup-okx-[a-f0-9]+$/);
  });

  /**
   * Reproduced live on repodiet-agent-9636: event 456f7e76 on job 0x22a2…,
   * already `accepted` with escrow funded, retried every 60 seconds and failed
   * every time with `model_turn_retryable:internal_failure_retryable`. The
   * turn was handed `wakeup_notify`'s playbook — which is a REDIRECT, not an
   * instruction — matched neither known shape, and returned `unrecognized`.
   * Retryable, so never terminal; never progressing, so never delivered. That
   * is the OKX-reported "task times out" class exactly.
   */
  await test("a wakeup_notify redirect is followed to the real business playbook", async () => {
    const fetched: Array<{ event: string; jobId: string }> = [];
    const github = fakeGitHub([]);
    const turn = createDeterministicTurn({
      agentId: "9636",
      runner: (async () =>
        ok("serviceParams: repository=https://github.com/velz-cmd/repodiet-e2e-test\n")) as never,
      readTask: async () => TASK,
      createCleanupPr: (async (input: { repoUrl: string }) => ({
        data: {
          pullRequest: { number: 9, url: `${input.repoUrl}/pull/9` },
          actionSummary: {},
          repo: { cleanupBranch: "repodiet/cleanup-x" },
        },
      })) as never,
      resolveGitHubToken: github.resolveGitHubToken,
      createGitHubClient: github.createGitHubClient,
      refetchInstruction: (async ({ event, jobId }: { event: string; jobId: string }) => {
        fetched.push({ event, jobId });
        return { ok: true, stdout: JOB_ACCEPTED_PLAYBOOK, stderr: "" };
      }) as never,
    });

    const result = await turn({
      instruction: WAKEUP_REDIRECT_PLAYBOOK,
      jobId: JOB,
      envelope: { agentId: "9636", message: { event: "wakeup_notify", jobId: JOB, jobStatus: "accepted" } } as never,
    });

    assert.equal(result.ok, true, "the redirect must be followed, not treated as unrecognized");
    assert.deepEqual(fetched, [{ event: "accepted", jobId: JOB }], "re-request with the REAL status");
    assert.equal(result.actions[1].command, "agent deliver");
  });

  await test("a wakeup redirect takes its status from the ENVELOPE, never from the playbook prose", async () => {
    // The playbook only says *where to look*. Reading the value from generated
    // text would let prose choose which playbook runs next.
    const turn = createDeterministicTurn({
      agentId: "9636",
      runner: (async () => ok("")) as never,
      readTask: async () => TASK,
      refetchInstruction: (async () => {
        throw new Error("must not refetch without a resolvable envelope status");
      }) as never,
    });

    for (const envelope of [
      undefined,
      { agentId: "9636", message: { event: "wakeup_notify", jobId: JOB } },
      { agentId: "9636", message: { event: "wakeup_notify", jobId: JOB, jobStatus: "not-a-status" } },
      { agentId: "9636", message: { event: "wakeup_notify", jobId: JOB, jobStatus: 42 } },
    ]) {
      const result = await turn({
        instruction: WAKEUP_REDIRECT_PLAYBOOK,
        jobId: JOB,
        envelope: envelope as never,
      });
      assert.equal(result.ok, false);
      assert.equal(result.error, "wakeup_redirect_status_unresolved");
    }
  });

  await test("a redirect that redirects again is refused rather than looping forever", async () => {
    const turn = createDeterministicTurn({
      agentId: "9636",
      runner: (async () => ok("")) as never,
      readTask: async () => TASK,
      refetchInstruction: (async () => ({
        ok: true,
        stdout: WAKEUP_REDIRECT_PLAYBOOK,
        stderr: "",
      })) as never,
    });

    const result = await turn({
      instruction: WAKEUP_REDIRECT_PLAYBOOK,
      jobId: JOB,
      envelope: { agentId: "9636", message: { event: "wakeup_notify", jobId: JOB, jobStatus: "accepted" } } as never,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "wakeup_redirect_loop");
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
    const github = fakeGitHub([]);
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
      resolveGitHubToken: github.resolveGitHubToken,
      createGitHubClient: github.createGitHubClient,
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
