/**
 * Provider-application regression battery.
 *
 * The defect: read live from Agent 9636's own provider view, seven jobs sat
 * at `status: created` with 9636 named as ASP and ZERO applications. The
 * runtime had no code path that could call `onchainos agent apply` — the
 * command was not even allowlisted, so a model turn proposing it would have
 * been refused at the authorization boundary. A designated job that is never
 * applied for cannot be confirmed, cannot fund escrow, and times out.
 *
 * `agent apply` is "apply API → sign → broadcast" — irreversible, on-chain,
 * gas-spending. These tests exist mainly to prove it can NEVER fire on the
 * wrong job, twice, or at the wrong price.
 */
import assert from "node:assert/strict";
import {
  applyLedgerKey,
  assessApplyEligibility,
  buildApplyAction,
  isDiscoveryOnlyTitle,
  parseApplyMode,
  X_LAYER_CHAIN_INDEX,
  type ApplyCandidate,
} from "../src/lib/okx-runtime/provider-apply";
import { ALLOWED_COMMANDS, authorizeAction } from "../src/lib/okx-runtime/system-event-route";

function test(name: string, fn: () => Promise<void> | void) {
  return (async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ ${name}`);
      throw err;
    }
  })();
}

const JOB = "0xcf2c9c7bce93db1825520ad87ec805b4f7852d686ec20018393a4bd796bfed13";

/** A job that genuinely qualifies — every gate authoritatively satisfied. */
function eligible(overrides: Partial<ApplyCandidate> = {}): ApplyCandidate {
  return {
    jobId: JOB,
    aspAgentId: "9636",
    buyerAgentId: "1791",
    myRole: "asp",
    statusCode: 0,
    tokenAmount: "1",
    tokenSymbol: "USDT",
    serviceId: "37348",
    operation: "create_cleanup_pr",
    chainIndex: X_LAYER_CHAIN_INDEX,
    repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
    title: "RepoDiet Verified Cleanup",
    ...overrides,
  };
}

function reasonFor(candidate: ApplyCandidate, prior?: Parameters<typeof assessApplyEligibility>[1]) {
  const verdict = assessApplyEligibility(candidate, prior);
  assert.equal(verdict.eligible, false, "expected this candidate to be refused");
  return verdict.eligible === false ? verdict.reason : "";
}

async function run() {
  console.log("okx-provider-apply");

  // --- the happy path ------------------------------------------------------

  await test("1. a genuinely eligible open job is accepted", () => {
    assert.deepEqual(assessApplyEligibility(eligible()), { eligible: true });
  });

  await test("2. the built command is the exact official invocation", () => {
    const action = buildApplyAction(eligible());
    assert.equal(action.command, "agent apply");
    assert.deepEqual(action.args, [
      JOB,
      "--token-amount",
      "1",
      "--token-symbol",
      "USDT",
      "--agent-id",
      "9636",
    ]);
  });

  await test("3. `agent apply` is allowlisted — it previously was not, so it could never run", () => {
    assert.ok(ALLOWED_COMMANDS.has("agent apply"));
  });

  await test("4. the built command passes the real authorization boundary", () => {
    const verdict = authorizeAction(buildApplyAction(eligible()), {
      jobId: JOB,
      aspAgentId: "9636",
      buyerAgentId: "1791",
      statusCode: 0,
      tokenAmount: "1",
      tokenSymbol: "USDT",
    }, JOB);
    assert.deepEqual(verdict, { allowed: true });
  });

  // --- identity and role ---------------------------------------------------

  await test("5. a job designated to another provider is refused", () => {
    assert.equal(reasonFor(eligible({ aspAgentId: "5283" })), "not_designated_provider");
    assert.equal(reasonFor(eligible({ aspAgentId: undefined })), "not_designated_provider");
  });

  await test("6. a non-provider role is refused", () => {
    assert.match(reasonFor(eligible({ myRole: "user" })), /not_provider_role/);
  });

  await test("7. a job with no identifiable buyer is refused", () => {
    assert.equal(reasonFor(eligible({ buyerAgentId: undefined })), "buyer_unknown");
  });

  await test("8. self-dealing is refused — never apply to our own task", () => {
    assert.equal(reasonFor(eligible({ buyerAgentId: "9636" })), "buyer_is_self");
  });

  await test("9. a malformed job id is refused before anything else is considered", () => {
    assert.equal(reasonFor(eligible({ jobId: "not-a-job" })), "job_id_malformed");
    assert.equal(reasonFor(eligible({ jobId: "0x1234" })), "job_id_malformed");
  });

  // --- service and operation ----------------------------------------------

  await test("10. a non-A2A service is refused — 37347 is the paid A2MCP endpoint, not an escrow job", () => {
    assert.match(reasonFor(eligible({ serviceId: "37347" })), /service_not_a2a:37347/);
  });

  await test("10b. an absent serviceId is inferred ONLY from escrow corroboration, never assumed", () => {
    // Verified live: none of `active-tasks`, `agent status` or `agent common
    // context` returns a serviceId. Requiring one would refuse every real job
    // and make the whole apply path a silent no-op — the exact failure mode
    // this battery exists to prevent.
    assert.equal(reasonFor(eligible({ serviceId: undefined })), "service_unverifiable");
    assert.equal(
      reasonFor(eligible({ serviceId: undefined, escrowPayment: false })),
      "service_unverifiable"
    );
    assert.deepEqual(
      assessApplyEligibility(eligible({ serviceId: undefined, escrowPayment: true })),
      { eligible: true },
      "escrow payment on a job designated to 9636 can only be service 37348"
    );
    // Corroboration must never override an explicit, contradicting serviceId.
    assert.match(
      reasonFor(eligible({ serviceId: "37347", escrowPayment: true })),
      /service_not_a2a:37347/
    );
  });

  await test("11. an operation other than create_cleanup_pr is refused", () => {
    assert.match(
      reasonFor(eligible({ operation: "analyze_repository" })),
      /operation_not_cleanup/
    );
  });

  // --- lifecycle -----------------------------------------------------------

  await test("12. only `created` (0) is applicable — accepted and every terminal state are refused", () => {
    for (const statusCode of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      assert.match(
        reasonFor(eligible({ statusCode })),
        /status_not_open/,
        `statusCode ${statusCode} must not be applicable`
      );
    }
  });

  await test("13. the authorization boundary independently refuses apply at a non-open status", () => {
    // Defence in depth: even if eligibility were bypassed, the boundary that
    // sits in front of every action still refuses.
    const verdict = authorizeAction(buildApplyAction(eligible()), {
      jobId: JOB,
      aspAgentId: "9636",
      buyerAgentId: "1791",
      statusCode: 1, // accepted — already applied for
      tokenAmount: "1",
      tokenSymbol: "USDT",
    }, JOB);
    assert.equal(verdict.allowed, false);
    assert.match(verdict.allowed === false ? verdict.reason : "", /apply_status_not_open:1/);
  });

  // --- network -------------------------------------------------------------

  await test("14. a non-X-Layer network is refused", () => {
    assert.match(reasonFor(eligible({ chainIndex: 1 })), /network_not_x_layer:1/);
  });

  // --- price ---------------------------------------------------------------

  await test("15. a zero or empty amount is refused — the CLI treats it as an IRREVERSIBLE free apply", () => {
    assert.equal(reasonFor(eligible({ tokenAmount: "0" })), "token_amount_not_positive");
    assert.equal(reasonFor(eligible({ tokenAmount: "0.0" })), "token_amount_not_positive");
    assert.match(reasonFor(eligible({ tokenAmount: "" })), /token_amount_malformed/);
    assert.match(reasonFor(eligible({ tokenAmount: "abc" })), /token_amount_malformed/);
    assert.match(reasonFor(eligible({ tokenAmount: "-1" })), /token_amount_malformed/);
  });

  await test("16. the authorization boundary independently refuses a free apply", () => {
    const verdict = authorizeAction(
      { command: "agent apply", args: [JOB, "--token-amount", "0", "--token-symbol", "USDT", "--agent-id", "9636"] },
      { jobId: JOB, aspAgentId: "9636", buyerAgentId: "1791", statusCode: 0, tokenAmount: "0", tokenSymbol: "USDT" },
      JOB
    );
    assert.equal(verdict.allowed, false);
    assert.match(verdict.allowed === false ? verdict.reason : "", /apply_token_amount_not_positive/);
  });

  await test("17. an amount that disagrees with the authoritative task is refused by the boundary", () => {
    // The reviewer jobs carry 0.00001; the registered fee is 1. The runtime
    // must apply at the task's negotiated amount, never at a remembered one.
    const verdict = authorizeAction(
      buildApplyAction(eligible({ tokenAmount: "1" })),
      { jobId: JOB, aspAgentId: "9636", buyerAgentId: "1791", statusCode: 0, tokenAmount: "0.00001", tokenSymbol: "USDT" },
      JOB
    );
    assert.equal(verdict.allowed, false);
    assert.match(verdict.allowed === false ? verdict.reason : "", /token_amount_not_authoritative/);
  });

  await test("18. a small but positive negotiated amount is accepted and carried through exactly", () => {
    const candidate = eligible({ tokenAmount: "0.00001" });
    assert.deepEqual(assessApplyEligibility(candidate), { eligible: true });
    assert.equal(buildApplyAction(candidate).args[2], "0.00001");
  });

  await test("19. a missing token symbol is refused — the CLI warns not to assume USDT", () => {
    assert.equal(reasonFor(eligible({ tokenSymbol: "" })), "token_symbol_missing");
  });

  // --- scope ---------------------------------------------------------------

  await test("20. a job with no usable repository scope is refused", () => {
    assert.equal(reasonFor(eligible({ repositoryUrl: undefined })), "repository_scope_missing");
    assert.equal(reasonFor(eligible({ repositoryUrl: "not a url" })), "repository_scope_missing");
    assert.equal(
      reasonFor(eligible({ repositoryUrl: "https://gitlab.com/a/b" })),
      "repository_scope_missing"
    );
  });

  await test("21. a discovery question never triggers an on-chain application", () => {
    for (const title of ["Is RepoDiet online?", "What services do you offer?", "hello", "ping"]) {
      assert.equal(isDiscoveryOnlyTitle(title), true, `must be discovery: ${title}`);
      assert.equal(
        reasonFor(eligible({ title })),
        "discovery_message_not_a_task",
        `must refuse: ${title}`
      );
    }
    // Real job titles seen live on this agent — none may be mistaken for
    // chatter, or the runtime would refuse genuine paid work. "RepoDiet
    // Availability Check" in particular is a real 0.2 USDT task that reached
    // `accepted`, despite reading like a probe.
    for (const title of [
      "RepoDiet Verified Cleanup",
      "Clean up unused dependencies",
      "RepoDiet Availability Check",
      "GitHub Repo Cleanup Request",
      "Optimize JS codebase",
      "Clean up legacy code in repo",
    ]) {
      assert.equal(isDiscoveryOnlyTitle(title), false, `must NOT be discovery: ${title}`);
      assert.deepEqual(
        assessApplyEligibility(eligible({ title })),
        { eligible: true },
        `must remain eligible: ${title}`
      );
    }
  });

  // --- idempotency ---------------------------------------------------------

  await test("22. a job already applied for is never applied for again", () => {
    assert.equal(
      reasonFor(eligible(), { jobId: JOB, state: "applied", transactionRef: "0xabc" }),
      "already_applied"
    );
  });

  await test("23. an UNCONFIRMED prior broadcast blocks a retry — never blind-retry a signed action", () => {
    // The rule that prevents a double broadcast: an uncertain transaction is
    // treated as firmly as a confirmed one until reconciliation resolves it.
    assert.equal(
      reasonFor(eligible(), { jobId: JOB, state: "uncertain" }),
      "prior_broadcast_unconfirmed"
    );
  });

  await test("24. a cleanly FAILED prior attempt may be retried — it never broadcast", () => {
    assert.deepEqual(
      assessApplyEligibility(eligible(), { jobId: JOB, state: "failed" }),
      { eligible: true }
    );
  });

  await test("25. the ledger key is stable, job-scoped and case-insensitive", () => {
    assert.equal(applyLedgerKey(JOB), applyLedgerKey(JOB.toUpperCase()));
    assert.match(applyLedgerKey(JOB), /^provider_apply:0x[a-f0-9]{64}$/);
    assert.notEqual(
      applyLedgerKey(JOB),
      applyLedgerKey("0x4671466defdd364d23762ffe5c9f6a3046b13ab59821df048f472e56fd0611f7")
    );
  });

  // --- ordering ------------------------------------------------------------

  await test("26. eligibility reports the job's own disqualifier ahead of our bookkeeping", () => {
    // A terminal job that we also have a ledger entry for should report the
    // status, not "already_applied" — otherwise operators chase the wrong thing.
    assert.match(
      reasonFor(eligible({ statusCode: 7 }), { jobId: JOB, state: "applied" }),
      /status_not_open:7/
    );
  });

  // --- operating mode ------------------------------------------------------

  await test("27. apply mode defaults to dry_run — an unset environment never broadcasts", () => {
    assert.equal(parseApplyMode(undefined), "dry_run");
    assert.equal(parseApplyMode(""), "dry_run");
    assert.equal(parseApplyMode("nonsense"), "dry_run");
    assert.equal(parseApplyMode("live"), "live");
    assert.equal(parseApplyMode("LIVE"), "live");
    assert.equal(parseApplyMode("off"), "off");
  });

  // --- boundary invariants -------------------------------------------------

  await test("28. apply can never be redirected onto a different job", () => {
    const other = "0x4671466defdd364d23762ffe5c9f6a3046b13ab59821df048f472e56fd0611f7";
    const verdict = authorizeAction(
      buildApplyAction(eligible({ jobId: other })),
      { jobId: JOB, aspAgentId: "9636", buyerAgentId: "1791", statusCode: 0, tokenAmount: "1", tokenSymbol: "USDT" },
      JOB
    );
    assert.equal(verdict.allowed, false);
    assert.match(verdict.allowed === false ? verdict.reason : "", /job_id_mismatch|argument_job_id_mismatch/);
  });

  await test("29. apply can never be signed as another agent", () => {
    const verdict = authorizeAction(
      { command: "agent apply", args: [JOB, "--token-amount", "1", "--token-symbol", "USDT", "--agent-id", "5283"] },
      { jobId: JOB, aspAgentId: "9636", buyerAgentId: "1791", statusCode: 0, tokenAmount: "1", tokenSymbol: "USDT" },
      JOB
    );
    assert.equal(verdict.allowed, false);
    assert.match(verdict.allowed === false ? verdict.reason : "", /agent_id_not_seller/);
  });

  await test("30. buyer-side settlement commands remain forbidden — apply did not widen the allowlist", () => {
    for (const command of ["agent confirm-accept", "agent complete", "agent close", "agent create-task", "agent activate", "agent upload"]) {
      assert.equal(ALLOWED_COMMANDS.has(command), false, `${command} must stay forbidden`);
    }
  });

  console.log("okx-provider-apply: all passed");
}

run();
