/**
 * Evidence for the accepted-job recovery gap and the gates that close it
 * safely.
 *
 * The open-job sweep reconciles jobs stuck at `created`. Nothing reconciled a
 * job stuck at `accepted` — escrow funded, buyer waiting, no pending event to
 * replay — which is the exact live state of the funded production job. These
 * tests pin the two properties that make closing that gap safe: it acts on a
 * genuinely eligible job, and it refuses every near-miss rather than
 * delivering twice against real escrowed funds.
 */
import assert from "node:assert/strict";
import {
  assessAcceptedJobRecovery,
  buildRecoveryQueryEnvelope,
  parseDeliverableCount,
  recoverAcceptedJob,
  REPODIET_A2A_RECOVERY_POLICY,
  type AcceptedJobObservation,
  type AcceptedJobRecoveryDeps,
} from "../src/lib/okx-runtime/accepted-job-recovery";
import { cleanupBranchForJob } from "../src/lib/okx-runtime/deterministic-turn";
import type { ProposedAction } from "../src/lib/okx-runtime/system-event-route";

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
const REPO = "https://github.com/velz-cmd/repodiet-e2e-test";

/** The live production job's authoritative shape, as OKX reports it. */
function eligibleObservation(
  overrides: Partial<AcceptedJobObservation> = {}
): AcceptedJobObservation {
  return {
    jobId: JOB,
    task: {
      jobId: JOB,
      aspAgentId: "9636",
      buyerAgentId: "10466",
      statusCode: 1,
      tokenAmount: "1",
      tokenSymbol: "USDT",
      escrowPayment: true,
      chainIndex: 196,
      repositoryUrl: REPO,
    },
    deliverableCount: 0,
    repositoryUrl: REPO,
    installationAccess: true,
    existingPrUrl: undefined,
    ...overrides,
  };
}

function taskWith(patch: Record<string, unknown>): AcceptedJobObservation {
  const base = eligibleObservation();
  return { ...base, task: { ...base.task!, ...patch } as never };
}

async function run() {
  console.log("okx accepted-job recovery");

  // --- 1. eligible accepted job ---------------------------------------------

  await test("eligible accepted job passes every gate", () => {
    const verdict = assessAcceptedJobRecovery(eligibleObservation());
    assert.equal(verdict.eligible, true);
    if (!verdict.eligible) return;
    assert.equal(verdict.repositoryUrl, REPO);
    assert.equal(verdict.cleanupBranch, cleanupBranchForJob(JOB));
    assert.equal(
      verdict.cleanupBranch,
      "repodiet/cleanup-okx-22a216415e2b1176d2111b136584e42fd949f7c0"
    );
    assert.equal(verdict.reusePrUrl, undefined);
  });

  // --- 2. wrong provider -----------------------------------------------------

  await test("refuses a job designated to another provider", () => {
    const verdict = assessAcceptedJobRecovery(taskWith({ aspAgentId: "5295" }));
    assert.deepEqual(verdict, { eligible: false, reason: "not_designated_provider" });
  });

  await test("refuses the forbidden historical provider identity 5283", () => {
    const verdict = assessAcceptedJobRecovery(taskWith({ aspAgentId: "5283" }));
    assert.equal(verdict.eligible, false);
  });

  // --- 3. wrong service ------------------------------------------------------

  await test("refuses an explicit non-A2A serviceId", () => {
    const verdict = assessAcceptedJobRecovery(taskWith({ serviceId: "37347" }));
    assert.deepEqual(verdict, { eligible: false, reason: "service_not_a2a:37347" });
  });

  await test("refuses an operation that is not create_cleanup_pr", () => {
    const verdict = assessAcceptedJobRecovery(taskWith({ operation: "analyze_repository" }));
    assert.deepEqual(verdict, {
      eligible: false,
      reason: "operation_not_cleanup:analyze_repository",
    });
  });

  await test("accepts the A2A serviceId when OKX does expose it", () => {
    const verdict = assessAcceptedJobRecovery(taskWith({ serviceId: "37348" }));
    assert.equal(verdict.eligible, true);
  });

  // --- 4. wrong price --------------------------------------------------------

  await test("refuses the reviewer-probe price 0.00001", () => {
    const verdict = assessAcceptedJobRecovery(taskWith({ tokenAmount: "0.00001" }));
    assert.deepEqual(verdict, { eligible: false, reason: "price_not_registered:0.00001!=1" });
  });

  await test("treats 1.00 as the registered price", () => {
    assert.equal(assessAcceptedJobRecovery(taskWith({ tokenAmount: "1.00" })).eligible, true);
  });

  await test("refuses a malformed amount", () => {
    const verdict = assessAcceptedJobRecovery(taskWith({ tokenAmount: "" }));
    assert.equal(verdict.eligible, false);
    assert.match((verdict as { reason: string }).reason, /token_amount_malformed/);
  });

  await test("refuses a matching symbol on a different token contract", () => {
    const verdict = assessAcceptedJobRecovery(
      taskWith({ tokenAddress: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" })
    );
    assert.equal(verdict.eligible, false);
    assert.match((verdict as { reason: string }).reason, /token_asset_not_registered/);
  });

  await test("refuses a job on the wrong network", () => {
    const verdict = assessAcceptedJobRecovery(taskWith({ chainIndex: 1 }));
    assert.deepEqual(verdict, { eligible: false, reason: "network_not_x_layer:1" });
  });

  // --- 5. missing escrow -----------------------------------------------------

  await test("refuses when escrow is not corroborated", () => {
    const verdict = assessAcceptedJobRecovery(taskWith({ escrowPayment: undefined }));
    // With no serviceId either, the service itself is unverifiable — refused
    // before the escrow gate, and refused either way.
    assert.equal(verdict.eligible, false);
    assert.equal((verdict as { reason: string }).reason, "service_unverifiable");
  });

  await test("refuses an accepted job with an explicit non-escrow payment", () => {
    const verdict = assessAcceptedJobRecovery(
      taskWith({ escrowPayment: false, serviceId: "37348" })
    );
    assert.deepEqual(verdict, { eligible: false, reason: "escrow_not_funded" });
  });

  // --- 6. existing deliverable ----------------------------------------------

  await test("refuses when a deliverable already exists", () => {
    const verdict = assessAcceptedJobRecovery(eligibleObservation({ deliverableCount: 1 }));
    assert.deepEqual(verdict, { eligible: false, reason: "deliverable_already_exists" });
  });

  await test("refuses when the deliverable count is unreadable", () => {
    const verdict = assessAcceptedJobRecovery(eligibleObservation({ deliverableCount: undefined }));
    assert.deepEqual(verdict, { eligible: false, reason: "deliverable_state_uncertain" });
  });

  // --- 7. existing deterministic PR -----------------------------------------

  await test("reuses an existing PR on the deterministic branch", () => {
    const url = "https://github.com/velz-cmd/repodiet-e2e-test/pull/7";
    const verdict = assessAcceptedJobRecovery(eligibleObservation({ existingPrUrl: url }));
    assert.equal(verdict.eligible, true);
    if (!verdict.eligible) return;
    // Eligible, but flagged for reuse — never a second PR for the same job.
    assert.equal(verdict.reusePrUrl, url);
  });

  // --- 8. completed / settled job -------------------------------------------

  await test("refuses a created job — the open-job sweep owns that state", () => {
    const verdict = assessAcceptedJobRecovery(taskWith({ statusCode: 0 }));
    assert.deepEqual(verdict, { eligible: false, reason: "status_not_accepted:0" });
  });

  for (const [code, label] of [
    [2, "submitted"],
    [3, "refused"],
    [4, "disputed"],
    [5, "completed"],
    [6, "closed"],
    [7, "expired"],
    [8, "rejected"],
    [9, "admin_stopped"],
  ] as const) {
    await test(`refuses a ${label} job (status ${code})`, () => {
      const verdict = assessAcceptedJobRecovery(taskWith({ statusCode: code }));
      assert.deepEqual(verdict, { eligible: false, reason: `status_not_accepted:${code}` });
    });
  }

  // --- reviewer-owned / unrelated jobs --------------------------------------

  await test("refuses a job from a buyer that is not the pinned counterparty", () => {
    const verdict = assessAcceptedJobRecovery(taskWith({ buyerAgentId: "5295" }));
    assert.deepEqual(verdict, {
      eligible: false,
      reason: "buyer_not_pinned_counterparty:5295",
    });
  });

  await test("refuses self-dealing", () => {
    const verdict = assessAcceptedJobRecovery(
      taskWith({ buyerAgentId: "9636" }),
      { ...REPODIET_A2A_RECOVERY_POLICY, buyerAgentId: "9636" }
    );
    assert.deepEqual(verdict, { eligible: false, reason: "buyer_is_self" });
  });

  // --- fail-closed on uncertain state ---------------------------------------

  await test("refuses when authoritative state is unavailable", () => {
    const verdict = assessAcceptedJobRecovery(eligibleObservation({ task: undefined }));
    assert.deepEqual(verdict, { eligible: false, reason: "authoritative_state_unavailable" });
  });

  await test("refuses when the authoritative read is for a different job", () => {
    const other = `0x${"b".repeat(64)}`;
    const verdict = assessAcceptedJobRecovery(taskWith({ jobId: other }));
    assert.deepEqual(verdict, { eligible: false, reason: "authoritative_job_id_mismatch" });
  });

  await test("refuses a malformed job id", () => {
    const verdict = assessAcceptedJobRecovery(eligibleObservation({ jobId: "0xnope" }));
    assert.deepEqual(verdict, { eligible: false, reason: "job_id_malformed" });
  });

  await test("refuses an unresolved repository url", () => {
    const verdict = assessAcceptedJobRecovery(eligibleObservation({ repositoryUrl: undefined }));
    assert.deepEqual(verdict, { eligible: false, reason: "repository_url_unresolved" });
  });

  await test("refuses a repository url that is not parseable", () => {
    const verdict = assessAcceptedJobRecovery(
      eligibleObservation({ repositoryUrl: "https://example.com/not-github" })
    );
    assert.deepEqual(verdict, { eligible: false, reason: "repository_url_invalid" });
  });

  await test("refuses when installation access is inconclusive", () => {
    const verdict = assessAcceptedJobRecovery(
      eligibleObservation({ installationAccess: undefined })
    );
    assert.deepEqual(verdict, {
      eligible: false,
      reason: "github_installation_access_unavailable",
    });
  });

  await test("refuses when installation access is denied", () => {
    const verdict = assessAcceptedJobRecovery(eligibleObservation({ installationAccess: false }));
    assert.deepEqual(verdict, {
      eligible: false,
      reason: "github_installation_access_unavailable",
    });
  });

  // --- the query envelope is never a forged event ---------------------------

  await test("recovery query envelope carries only observed identity", () => {
    const envelope = buildRecoveryQueryEnvelope(JOB) as {
      agentId: string;
      message: Record<string, unknown>;
    };
    assert.equal(envelope.agentId, "9636");
    assert.deepEqual(envelope.message, { event: "job_accepted", jobId: JOB });
    // No transport id, signature, timestamp or delivery metadata — nothing that
    // would let this be mistaken for (or persisted as) a real inbound event.
    assert.deepEqual(Object.keys(envelope.message).sort(), ["event", "jobId"]);
  });

  // --- orchestration --------------------------------------------------------

  const DELIVER_PLAYBOOK = `[Current state] job_accepted (User Agent has confirmed the apply)
  [Role] ASP (Agent Service ASP)
    - title: RepoDiet Verified Cleanup
    - description: Repository: ${REPO}. Do not push directly to the default branch.
    - tokenAmount: 1
    - tokenSymbol: USDT
    - buyerAgentId: 10466
  `;

  function orchestrationDeps(
    overrides: Partial<AcceptedJobRecoveryDeps> = {}
  ): AcceptedJobRecoveryDeps & { ran: ProposedAction[]; logs: string[] } {
    const ran: ProposedAction[] = [];
    const logs: string[] = [];
    const deps = {
      ran,
      logs,
      readTask: async () => eligibleObservation().task,
      listDeliverables: async () => 0,
      hasInstallationAccess: async () => true,
      findExistingPr: async () => undefined,
      fetchInstruction: async () => ({ ok: true, stdout: DELIVER_PLAYBOOK, stderr: "" }),
      runTurn: async () => ({
        ok: true,
        actions: [
          { command: "agent user-notify", args: ["--content", "accepted"] },
          { command: "agent deliver", args: [JOB, "--file", ""] },
        ] as ProposedAction[],
      }),
      runAction: async (action: ProposedAction) => {
        ran.push(action);
        return { ok: true, transactionRef: `0xtx-${ran.length}` };
      },
      log: (event: string) => {
        logs.push(event);
      },
      ...overrides,
    } as AcceptedJobRecoveryDeps & { ran: ProposedAction[]; logs: string[] };
    return deps;
  }

  await test("eligible job runs the deterministic turn's actions in order", async () => {
    const deps = orchestrationDeps();
    const outcome = await recoverAcceptedJob(JOB, deps);
    assert.equal(outcome.action, "recovered");
    if (outcome.action !== "recovered") return;
    assert.equal(outcome.actionsRun, 2);
    assert.deepEqual(deps.ran.map((a) => a.command), [
      "agent user-notify",
      "agent deliver",
    ]);
    assert.deepEqual(outcome.transactionRefs, ["0xtx-1", "0xtx-2"]);
  });

  // --- 9. repeated invocation idempotency ------------------------------------

  await test("a second invocation after delivery skips instead of delivering twice", async () => {
    let deliverables = 0;
    const deps = orchestrationDeps({
      // Models the real world: once the first run delivered, the official
      // deliverable list is no longer empty.
      listDeliverables: async () => deliverables,
      runAction: async () => {
        deliverables = 1;
        return { ok: true, transactionRef: "0xtx" };
      },
    });

    const first = await recoverAcceptedJob(JOB, deps);
    assert.equal(first.action, "recovered");

    const second = await recoverAcceptedJob(JOB, deps);
    assert.deepEqual(second, {
      action: "skipped",
      jobId: JOB,
      reason: "deliverable_already_exists",
    });
  });

  await test("a repeated invocation on a job that moved to submitted skips", async () => {
    let statusCode = 1;
    const deps = orchestrationDeps({
      readTask: async () => ({ ...eligibleObservation().task!, statusCode }),
      runAction: async () => {
        statusCode = 2;
        return { ok: true, transactionRef: "0xtx" };
      },
    });
    assert.equal((await recoverAcceptedJob(JOB, deps)).action, "recovered");
    const second = await recoverAcceptedJob(JOB, deps);
    assert.deepEqual(second, {
      action: "skipped",
      jobId: JOB,
      reason: "status_not_accepted:2",
    });
  });

  await test("never runs an action for an ineligible job", async () => {
    const deps = orchestrationDeps({ listDeliverables: async () => 3 });
    const outcome = await recoverAcceptedJob(JOB, deps);
    assert.equal(outcome.action, "skipped");
    assert.equal(deps.ran.length, 0);
  });

  await test("never queries next-action for an ineligible job", async () => {
    let fetched = 0;
    const deps = orchestrationDeps({
      readTask: async () => ({ ...eligibleObservation().task!, statusCode: 5 }),
      fetchInstruction: async () => {
        fetched += 1;
        return { ok: true, stdout: DELIVER_PLAYBOOK, stderr: "" };
      },
    });
    await recoverAcceptedJob(JOB, deps);
    assert.equal(fetched, 0);
  });

  await test("an unreadable deliverable list refuses rather than assuming none", async () => {
    const deps = orchestrationDeps({
      listDeliverables: async () => {
        throw new Error("cli_unavailable");
      },
    });
    const outcome = await recoverAcceptedJob(JOB, deps);
    assert.deepEqual(outcome, {
      action: "skipped",
      jobId: JOB,
      reason: "deliverable_state_uncertain",
    });
    assert.equal(deps.ran.length, 0);
  });

  await test("a failed authoritative read skips without acting", async () => {
    const deps = orchestrationDeps({
      readTask: async () => {
        throw new Error("session expired");
      },
    });
    const outcome = await recoverAcceptedJob(JOB, deps);
    assert.equal(outcome.action, "skipped");
    assert.match((outcome as { reason: string }).reason, /authoritative_read_failed/);
    assert.equal(deps.ran.length, 0);
  });

  await test("an unavailable playbook fails without acting", async () => {
    const deps = orchestrationDeps({
      fetchInstruction: async () => ({ ok: false, stdout: "", stderr: "boom" }),
    });
    const outcome = await recoverAcceptedJob(JOB, deps);
    assert.deepEqual(outcome, { action: "failed", jobId: JOB, reason: "next_action_unavailable" });
    assert.equal(deps.ran.length, 0);
  });

  await test("a failed deterministic turn fails without acting", async () => {
    const deps = orchestrationDeps({
      runTurn: async () => ({ ok: false, actions: [], error: "repository_url_unresolved" }),
    });
    const outcome = await recoverAcceptedJob(JOB, deps);
    assert.deepEqual(outcome, {
      action: "failed",
      jobId: JOB,
      reason: "repository_url_unresolved",
    });
    assert.equal(deps.ran.length, 0);
  });

  await test("an uncertain action outcome stops the run and is reported as uncertain", async () => {
    const deps = orchestrationDeps({
      runAction: async () => ({
        ok: false,
        uncertain: true,
        error: "action_timeout_outcome_unknown",
        transactionRef: "0xmaybe",
      }),
    });
    const outcome = await recoverAcceptedJob(JOB, deps);
    assert.equal(outcome.action, "failed");
    assert.match((outcome as { reason: string }).reason, /action_outcome_uncertain/);
  });

  await test("a later action failing stops the sequence", async () => {
    const ran: ProposedAction[] = [];
    const deps = orchestrationDeps({
      runAction: async (action) => {
        ran.push(action);
        return ran.length === 1
          ? { ok: true, transactionRef: "0xtx-1" }
          : { ok: false, error: "deliver_rejected" };
      },
    });
    const outcome = await recoverAcceptedJob(JOB, deps);
    assert.equal(outcome.action, "failed");
    assert.equal(ran.length, 2);
  });

  await test("dry run reports the verdict and targets without running any action", async () => {
    const deps = orchestrationDeps({ dryRun: true });
    const outcome = await recoverAcceptedJob(JOB, deps);
    assert.equal(outcome.action, "dry_run");
    if (outcome.action !== "dry_run") return;
    assert.equal(outcome.repositoryUrl, REPO);
    assert.equal(outcome.cleanupBranch, cleanupBranchForJob(JOB));
    assert.equal(deps.ran.length, 0);
  });

  /**
   * The turn is not a planner — it CREATES the pull request while producing
   * its actions. A dry run that called it would write a real branch and a real
   * PR to a real repository, which is the opposite of what --dry-run promises.
   */
  await test("dry run stops before the deterministic turn, so no PR is created", async () => {
    let turnCalls = 0;
    let instructionCalls = 0;
    const deps = orchestrationDeps({
      dryRun: true,
      fetchInstruction: async () => {
        instructionCalls += 1;
        return { ok: true, stdout: DELIVER_PLAYBOOK, stderr: "" };
      },
      runTurn: async () => {
        turnCalls += 1;
        return { ok: true, actions: [] };
      },
    });
    const outcome = await recoverAcceptedJob(JOB, deps);
    assert.equal(outcome.action, "dry_run");
    assert.equal(turnCalls, 0, "dry run must never invoke the PR-creating turn");
    assert.equal(instructionCalls, 0);
    assert.equal(deps.ran.length, 0);
  });

  await test("dry run on an ineligible job still skips", async () => {
    const deps = orchestrationDeps({ dryRun: true, listDeliverables: async () => 1 });
    const outcome = await recoverAcceptedJob(JOB, deps);
    assert.deepEqual(outcome, {
      action: "skipped",
      jobId: JOB,
      reason: "deliverable_already_exists",
    });
  });

  await test("dry run surfaces an existing PR as the reuse target", async () => {
    const url = "https://github.com/velz-cmd/repodiet-e2e-test/pull/9";
    const deps = orchestrationDeps({ dryRun: true, findExistingPr: async () => url });
    const outcome = await recoverAcceptedJob(JOB, deps);
    assert.equal(outcome.action, "dry_run");
    if (outcome.action !== "dry_run") return;
    assert.equal(outcome.reusePrUrl, url);
  });

  // --- deliverable-list parsing (live CLI shape) ---------------------------
  //
  // The first live dry-run refused with `deliverable_state_uncertain` because
  // this script invoked `task-deliverable-list` with `--agent-id`, which that
  // subcommand rejects (exit 2). The fail-closed path behaved correctly on an
  // argument list that could never have succeeded — and the parser would ALSO
  // have failed on the real payload, which is wrapped in `data`.

  await test("counts deliverables in the live wrapped CLI payload", () => {
    assert.equal(parseDeliverableCount('{"ok":true,"data":{"deliverables":[]}}'), 0);
    assert.equal(parseDeliverableCount('{"ok":true,"data":{"deliverables":[{"id":1}]}}'), 1);
  });

  await test("accepts a bare unwrapped payload too", () => {
    assert.equal(parseDeliverableCount('{"deliverables":[{"a":1},{"b":2}]}'), 2);
  });

  await test("throws rather than reporting zero on an unrecognised shape", () => {
    assert.throws(() => parseDeliverableCount('{"data":{}}'), /unrecognised_shape/);
    assert.throws(() => parseDeliverableCount("{}"), /unrecognised_shape/);
  });

  await test("throws on an explicit CLI failure payload", () => {
    assert.throws(
      () => parseDeliverableCount('{"ok":false,"error":"session expired"}'),
      /not_ok/
    );
  });

  await test("throws on non-JSON output", () => {
    assert.throws(() => parseDeliverableCount("error: unexpected argument"));
  });

  console.log("okx accepted-job recovery: all assertions passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
