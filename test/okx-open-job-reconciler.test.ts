/**
 * Open-job reconciliation battery.
 *
 * The sweep that closes the "designated but never applied for" gap. Its whole
 * risk surface is duplicate on-chain broadcasts, so most of these tests are
 * about what it must REFUSE to do.
 */
import assert from "node:assert/strict";
import {
  reconcileOpenJobs,
  type OpenJobReconcilerDeps,
  type ReconcileOutcome,
} from "../src/lib/okx-runtime/open-job-reconciler";
import type { ApplyCandidate, PriorApplication } from "../src/lib/okx-runtime/provider-apply";

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
const OTHER = "0x4671466defdd364d23762ffe5c9f6a3046b13ab59821df048f472e56fd0611f7";

function openJob(overrides: Partial<ApplyCandidate> = {}): ApplyCandidate {
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
    chainIndex: 196,
    repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
    title: "RepoDiet Verified Cleanup",
    ...overrides,
  };
}

interface Harness {
  deps: OpenJobReconcilerDeps;
  broadcasts: Array<readonly string[]>;
  ledger: Map<string, PriorApplication>;
  logs: Array<{ event: string; fields: Record<string, unknown> }>;
}

function harness(options: {
  jobs?: ApplyCandidate[];
  task?: Partial<ApplyCandidate>;
  taskThrows?: boolean;
  listThrows?: boolean;
  prior?: PriorApplication;
  run?: OpenJobReconcilerDeps["runAction"];
  mode?: OpenJobReconcilerDeps["mode"];
} = {}): Harness {
  const broadcasts: Array<readonly string[]> = [];
  const ledger = new Map<string, PriorApplication>();
  const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const jobs = options.jobs ?? [openJob()];
  if (options.prior) ledger.set(`provider_apply:${JOB.toLowerCase()}`, options.prior);

  return {
    broadcasts,
    ledger,
    logs,
    deps: {
      mode: options.mode ?? "live",
      listOpenJobs: async () => {
        if (options.listThrows) throw new Error("network down");
        return jobs;
      },
      readTask: async (jobId) => {
        if (options.taskThrows) throw new Error("status read failed");
        const listed = jobs.find((j) => j.jobId === jobId);
        if (!listed) return undefined;
        return { ...listed, ...options.task } as never;
      },
      getPriorApplication: async (key) => ledger.get(key),
      recordApplication: async (key, record) => {
        ledger.set(key, record);
      },
      runAction: options.run ??
        (async (action) => {
          broadcasts.push(action.args);
          return { ok: true, transactionRef: "0xdeadbeef" };
        }),
      log: (event, fields) => logs.push({ event, fields }),
    },
  };
}

function only(outcomes: ReconcileOutcome[]): ReconcileOutcome {
  assert.equal(outcomes.length, 1, `expected exactly one outcome, got ${outcomes.length}`);
  return outcomes[0];
}

async function run() {
  console.log("okx-open-job-reconciler");

  await test("1. an eligible open job is applied for exactly once, with the exact official argv", async () => {
    const h = harness();
    const outcome = only(await reconcileOpenJobs(h.deps));
    assert.equal(outcome.action, "applied");
    assert.equal(outcome.transactionRef, "0xdeadbeef");
    assert.equal(h.broadcasts.length, 1);
    assert.deepEqual(h.broadcasts[0], [
      JOB,
      "--token-amount",
      "1",
      "--token-symbol",
      "USDT",
      "--agent-id",
      "9636",
    ]);
  });

  await test("2. dry_run is the safe default — eligible, authorized, but never broadcast", async () => {
    const h = harness({ mode: "dry_run" });
    const outcome = only(await reconcileOpenJobs(h.deps));
    assert.equal(outcome.action, "dry_run");
    assert.equal(h.broadcasts.length, 0, "dry_run must never broadcast");
    assert.equal(h.ledger.size, 0, "dry_run must not write an application record");
    assert.ok(h.logs.some((l) => l.event === "open_job_apply_dry_run"));
  });

  await test("3. mode=off does nothing at all and does not even list", async () => {
    const h = harness({ mode: "off" });
    assert.deepEqual(await reconcileOpenJobs(h.deps), []);
    assert.equal(h.broadcasts.length, 0);
  });

  await test("4. a second sweep after a successful apply never re-broadcasts", async () => {
    const h = harness();
    await reconcileOpenJobs(h.deps);
    const second = only(await reconcileOpenJobs(h.deps));
    assert.equal(second.action, "skipped");
    assert.equal(second.reason, "already_applied");
    assert.equal(h.broadcasts.length, 1, "still exactly one broadcast across two sweeps");
  });

  await test("5. evidence is persisted BEFORE the broadcast, as `uncertain`", async () => {
    // Proves the crash window is covered: if the process dies mid-broadcast,
    // the ledger already says "uncertain", never "nothing happened".
    const seen: Array<PriorApplication["state"] | undefined> = [];
    const h = harness({
      run: async (action) => {
        seen.push(h.ledger.get(`provider_apply:${JOB.toLowerCase()}`)?.state);
        return { ok: true, transactionRef: "0xabc", args: action.args } as never;
      },
    });
    await reconcileOpenJobs(h.deps);
    assert.deepEqual(seen, ["uncertain"], "ledger must read `uncertain` at broadcast time");
    assert.equal(h.ledger.get(`provider_apply:${JOB.toLowerCase()}`)?.state, "applied");
  });

  await test("6. an UNCERTAIN prior broadcast is never blind-retried", async () => {
    const h = harness({ prior: { jobId: JOB, state: "uncertain" } });
    const outcome = only(await reconcileOpenJobs(h.deps));
    assert.equal(outcome.action, "skipped");
    assert.equal(outcome.reason, "prior_broadcast_unconfirmed");
    assert.equal(h.broadcasts.length, 0, "must NEVER re-broadcast an uncertain action");
  });

  await test("7. an uncertain broadcast that actually landed is reconciled from authoritative status", async () => {
    // The job has moved to accepted(1), so the earlier broadcast did land.
    // The ledger must self-correct to `applied` with no new broadcast.
    const h = harness({
      prior: { jobId: JOB, state: "uncertain", transactionRef: "0xearlier" },
      task: { statusCode: 1 },
    });
    const outcome = only(await reconcileOpenJobs(h.deps));
    assert.equal(outcome.action, "skipped");
    assert.equal(outcome.reason, "prior_broadcast_confirmed");
    assert.equal(h.broadcasts.length, 0);
    const record = h.ledger.get(`provider_apply:${JOB.toLowerCase()}`);
    assert.equal(record?.state, "applied");
    assert.equal(record?.transactionRef, "0xearlier", "the original tx ref must be preserved");
  });

  await test("8. a thrown broadcast leaves the ledger UNCERTAIN, never `failed`", async () => {
    const h = harness({
      run: async () => {
        throw new Error("connection reset mid-broadcast");
      },
    });
    const outcome = only(await reconcileOpenJobs(h.deps));
    assert.equal(outcome.action, "failed");
    assert.equal(outcome.reason, "broadcast_uncertain");
    assert.equal(
      h.ledger.get(`provider_apply:${JOB.toLowerCase()}`)?.state,
      "uncertain",
      "an ambiguous outcome must NOT be downgraded to a retryable failure"
    );
  });

  await test("9. a clean, definite failure is retryable on the next sweep", async () => {
    let attempts = 0;
    const h = harness({
      run: async () => {
        attempts++;
        return attempts === 1
          ? { ok: false, stderr: "insufficient gas", uncertain: false }
          : { ok: true, transactionRef: "0xlater" };
      },
    });
    const first = only(await reconcileOpenJobs(h.deps));
    assert.equal(first.action, "failed");
    assert.equal(h.ledger.get(`provider_apply:${JOB.toLowerCase()}`)?.state, "failed");

    const second = only(await reconcileOpenJobs(h.deps));
    assert.equal(second.action, "applied", "a failure that never broadcast may be retried");
    assert.equal(attempts, 2);
  });

  await test("10. a runner-flagged uncertain failure is NOT downgraded to retryable", async () => {
    const h = harness({
      run: async () => ({ ok: false, stderr: "timeout after signing", uncertain: true }),
    });
    const outcome = only(await reconcileOpenJobs(h.deps));
    assert.equal(outcome.reason, "broadcast_uncertain");
    assert.equal(h.ledger.get(`provider_apply:${JOB.toLowerCase()}`)?.state, "uncertain");
  });

  await test("11. authoritative task state overrides a stale listing", async () => {
    // The listing says open at 1 USDT; the authoritative read says the job has
    // already been accepted. The authoritative record must win and refuse.
    const h = harness({ task: { statusCode: 1 } });
    const outcome = only(await reconcileOpenJobs(h.deps));
    assert.equal(outcome.action, "skipped");
    assert.match(outcome.reason ?? "", /status_not_open:1/);
    assert.equal(h.broadcasts.length, 0);
  });

  await test("12. the amount broadcast comes from the authoritative task, never the listing", async () => {
    const h = harness({ task: { tokenAmount: "0.00001" } });
    const outcome = only(await reconcileOpenJobs(h.deps));
    assert.equal(outcome.action, "applied");
    assert.deepEqual(h.broadcasts[0][2], "0.00001");
  });

  await test("13. a job designated to another provider is never applied for", async () => {
    const h = harness({ jobs: [openJob({ aspAgentId: "5283" })] });
    const outcome = only(await reconcileOpenJobs(h.deps));
    assert.equal(outcome.action, "skipped");
    assert.equal(outcome.reason, "not_designated_provider");
    assert.equal(h.broadcasts.length, 0);
  });

  await test("14. a failed listing read is never treated as a clean, empty sweep", async () => {
    const h = harness({ listThrows: true });
    assert.deepEqual(await reconcileOpenJobs(h.deps), []);
    assert.ok(h.logs.some((l) => l.event === "open_job_reconcile_list_failed"));
    assert.equal(h.broadcasts.length, 0);
  });

  await test("15. a failed authoritative task read never proceeds to broadcast", async () => {
    const h = harness({ taskThrows: true });
    const outcome = only(await reconcileOpenJobs(h.deps));
    assert.equal(outcome.action, "failed");
    assert.match(outcome.reason ?? "", /task_read_failed/);
    assert.equal(h.broadcasts.length, 0);
  });

  await test("16. multiple eligible jobs are applied for sequentially, once each", async () => {
    const h = harness({
      jobs: [openJob(), openJob({ jobId: OTHER, buyerAgentId: "8178" })],
    });
    const outcomes = await reconcileOpenJobs(h.deps);
    assert.equal(outcomes.length, 2);
    assert.deepEqual(
      outcomes.map((o) => o.action),
      ["applied", "applied"]
    );
    assert.equal(h.broadcasts.length, 2);
    assert.deepEqual(
      h.broadcasts.map((b) => b[0]),
      [JOB, OTHER],
      "each broadcast must name its own job"
    );
  });

  await test("17. one ineligible job never blocks a sibling eligible one", async () => {
    const h = harness({
      jobs: [openJob({ repositoryUrl: undefined }), openJob({ jobId: OTHER })],
    });
    const outcomes = await reconcileOpenJobs(h.deps);
    assert.equal(outcomes[0].action, "skipped");
    assert.equal(outcomes[0].reason, "repository_scope_missing");
    assert.equal(outcomes[1].action, "applied");
    assert.equal(h.broadcasts.length, 1);
  });

  await test("18. a discovery-only job is never applied for", async () => {
    const h = harness({ jobs: [openJob({ title: "What services do you offer?" })] });
    const outcome = only(await reconcileOpenJobs(h.deps));
    assert.equal(outcome.reason, "discovery_message_not_a_task");
    assert.equal(h.broadcasts.length, 0);
  });

  await test("19. the completion log reports honest counts", async () => {
    const h = harness({
      jobs: [openJob(), openJob({ jobId: OTHER, serviceId: "37347" })],
    });
    await reconcileOpenJobs(h.deps);
    const complete = h.logs.find((l) => l.event === "open_job_reconcile_complete");
    assert.ok(complete);
    assert.equal(complete!.fields.examined, 2);
    assert.equal(complete!.fields.applied, 1);
    assert.equal(complete!.fields.skipped, 1);
  });

  await test("20. an empty open-job set is a clean no-op", async () => {
    const h = harness({ jobs: [] });
    assert.deepEqual(await reconcileOpenJobs(h.deps), []);
    assert.equal(h.broadcasts.length, 0);
  });

  console.log("okx-open-job-reconciler: all passed");
}

run();
