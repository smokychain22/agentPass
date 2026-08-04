/**
 * Periodic reconciliation of OPEN jobs designated to this provider.
 *
 * Events are the primary trigger for everything this runtime does, but they
 * are not sufficient on their own: a `job_asp_selected` notification that was
 * never delivered, arrived while the machine was down, or was dropped between
 * the gateway and the inbox leaves a real job sitting at `created` forever
 * with no event to replay. That is precisely the state seven live jobs were
 * found in.
 *
 * So this sweep exists as the safety net: it reads authoritative OKX state
 * directly, finds jobs that are genuinely open and genuinely ours, and
 * applies. It is a reconciler in the strict sense — it compares desired state
 * (we should have applied) against observed state (we have not) and closes
 * the gap, which makes it naturally idempotent and safe to run repeatedly.
 *
 * Every on-chain action still goes through the same eligibility gate, the
 * same authorization boundary and the same durable ledger as the event path.
 */
import {
  applyLedgerKey,
  assessApplyEligibility,
  buildApplyAction,
  parseApplyMode,
  type ApplyCandidate,
  type ApplyMode,
  type PriorApplication,
} from "./provider-apply";
import { authorizeAction, SELLER_AGENT_ID, type AuthoritativeTask } from "./system-event-route";

export interface OpenJobReconcilerDeps {
  /** Authoritative open-job listing (`onchainos agent active-tasks --role asp`). */
  listOpenJobs: () => Promise<ApplyCandidate[]>;
  /** Authoritative per-job re-read immediately before acting. */
  readTask: (jobId: string) => Promise<(AuthoritativeTask & Partial<ApplyCandidate>) | undefined>;
  /** Durable prior-application lookup. */
  getPriorApplication: (key: string) => Promise<PriorApplication | undefined>;
  /** Durable write. Must be persisted BEFORE the caller acts on it. */
  recordApplication: (
    key: string,
    record: PriorApplication & { updatedAt: string }
  ) => Promise<void>;
  /** Runs the official CLI action. */
  runAction: (action: {
    command: string;
    args: readonly string[];
  }) => Promise<{ ok: boolean; transactionRef?: string; stderr?: string; uncertain?: boolean }>;
  log: (event: string, fields: Record<string, unknown>) => void;
  mode?: ApplyMode;
}

export interface ReconcileOutcome {
  jobId: string;
  action: "applied" | "skipped" | "failed" | "dry_run";
  reason?: string;
  transactionRef?: string;
}

/**
 * One sweep.
 *
 * Sequential by design: two applications broadcast concurrently would contend
 * for the same wallet nonce, and a nonce collision is exactly the kind of
 * "uncertain broadcast" this module exists to avoid creating.
 */
export async function reconcileOpenJobs(
  deps: OpenJobReconcilerDeps
): Promise<ReconcileOutcome[]> {
  const mode = deps.mode ?? parseApplyMode(process.env.REPODIET_PROVIDER_APPLY_MODE);
  if (mode === "off") {
    deps.log("open_job_reconcile_disabled", { mode });
    return [];
  }

  let candidates: ApplyCandidate[];
  try {
    candidates = await deps.listOpenJobs();
  } catch (err) {
    // A failed read is not evidence that there is nothing to do. Never treat
    // it as a clean sweep.
    deps.log("open_job_reconcile_list_failed", {
      message: err instanceof Error ? err.message : "unknown_error",
    });
    return [];
  }

  const outcomes: ReconcileOutcome[] = [];
  for (const candidate of candidates) {
    outcomes.push(await reconcileOne(candidate, mode, deps));
  }

  deps.log("open_job_reconcile_complete", {
    mode,
    examined: candidates.length,
    applied: outcomes.filter((o) => o.action === "applied").length,
    dryRun: outcomes.filter((o) => o.action === "dry_run").length,
    skipped: outcomes.filter((o) => o.action === "skipped").length,
    failed: outcomes.filter((o) => o.action === "failed").length,
  });
  return outcomes;
}

async function reconcileOne(
  listed: ApplyCandidate,
  mode: ApplyMode,
  deps: OpenJobReconcilerDeps
): Promise<ReconcileOutcome> {
  const key = applyLedgerKey(listed.jobId);

  // 1. Prior state first — a job we have already acted on is never re-examined
  //    against a listing that may be seconds stale.
  const prior = await deps.getPriorApplication(key);
  if (prior?.state === "applied") {
    return { jobId: listed.jobId, action: "skipped", reason: "already_applied" };
  }

  // 2. Re-read AUTHORITATIVE per-job state. The listing is a discovery index;
  //    it is never the record an irreversible action is checked against. This
  //    is also what reconciles an unconfirmed prior broadcast: if the earlier
  //    attempt did land, the job is no longer at `created` and the eligibility
  //    gate below refuses on status, with no second broadcast.
  let task: (AuthoritativeTask & Partial<ApplyCandidate>) | undefined;
  try {
    task = await deps.readTask(listed.jobId);
  } catch (err) {
    return {
      jobId: listed.jobId,
      action: "failed",
      reason: `task_read_failed:${err instanceof Error ? err.message : "unknown"}`,
    };
  }
  if (!task) {
    return { jobId: listed.jobId, action: "skipped", reason: "task_unreadable" };
  }

  if (prior?.state === "uncertain") {
    // Resolve the ambiguity from authoritative state rather than retrying.
    if (task.statusCode !== 0) {
      await deps.recordApplication(key, {
        jobId: listed.jobId,
        state: "applied",
        transactionRef: prior.transactionRef,
        updatedAt: new Date().toISOString(),
      });
      deps.log("open_job_uncertain_broadcast_resolved", {
        jobId: listed.jobId,
        statusCode: task.statusCode,
        note: "prior broadcast did land; ledger corrected, no retry issued",
      });
      return { jobId: listed.jobId, action: "skipped", reason: "prior_broadcast_confirmed" };
    }
    // Still open. It genuinely may not have landed — but we will not guess.
    deps.log("open_job_uncertain_broadcast_unresolved", {
      jobId: listed.jobId,
      note: "prior broadcast unconfirmed and job still open; refusing to re-broadcast",
    });
    return { jobId: listed.jobId, action: "skipped", reason: "prior_broadcast_unconfirmed" };
  }

  // 3. Merge listing metadata under authoritative task facts — authoritative wins.
  const candidate: ApplyCandidate = {
    ...listed,
    ...task,
    jobId: listed.jobId,
    aspAgentId: task.aspAgentId ?? listed.aspAgentId,
    buyerAgentId: task.buyerAgentId ?? listed.buyerAgentId,
    statusCode: task.statusCode,
    tokenAmount: task.tokenAmount,
    tokenSymbol: task.tokenSymbol,
  };

  const eligibility = assessApplyEligibility(candidate, prior);
  if (!eligibility.eligible) {
    deps.log("open_job_not_eligible", { jobId: listed.jobId, reason: eligibility.reason });
    return { jobId: listed.jobId, action: "skipped", reason: eligibility.reason };
  }

  // 4. The authorization boundary re-verifies independently of eligibility.
  const action = buildApplyAction(candidate);
  const verdict = authorizeAction(action, {
    jobId: candidate.jobId,
    aspAgentId: candidate.aspAgentId ?? "",
    buyerAgentId: candidate.buyerAgentId ?? "",
    statusCode: candidate.statusCode,
    tokenAmount: candidate.tokenAmount,
    tokenSymbol: candidate.tokenSymbol,
  }, candidate.jobId);
  if (!verdict.allowed) {
    deps.log("open_job_apply_unauthorized", { jobId: listed.jobId, reason: verdict.reason });
    return { jobId: listed.jobId, action: "skipped", reason: `unauthorized:${verdict.reason}` };
  }

  if (mode === "dry_run") {
    deps.log("open_job_apply_dry_run", {
      jobId: listed.jobId,
      buyerAgentId: candidate.buyerAgentId,
      tokenAmount: candidate.tokenAmount,
      tokenSymbol: candidate.tokenSymbol,
      argv: action.args,
      note: "eligible and authorized; not broadcast because apply mode is dry_run",
    });
    return { jobId: listed.jobId, action: "dry_run" };
  }

  // 5. Mark the intent as UNCERTAIN before broadcasting. If the process dies
  //    between here and the result, recovery finds "uncertain" and reconciles
  //    against authoritative state instead of blind-retrying a signed action.
  await deps.recordApplication(key, {
    jobId: listed.jobId,
    state: "uncertain",
    updatedAt: new Date().toISOString(),
  });

  let result: Awaited<ReturnType<OpenJobReconcilerDeps["runAction"]>>;
  try {
    result = await deps.runAction(action);
  } catch (err) {
    // A thrown error is genuinely ambiguous — the broadcast may or may not
    // have gone out. The ledger stays `uncertain` on purpose.
    deps.log("open_job_apply_uncertain", {
      jobId: listed.jobId,
      message: err instanceof Error ? err.message : "unknown_error",
      note: "outcome unknown; left uncertain for reconciliation, never auto-retried",
    });
    return { jobId: listed.jobId, action: "failed", reason: "broadcast_uncertain" };
  }

  if (!result.ok) {
    if (result.uncertain) {
      deps.log("open_job_apply_uncertain", { jobId: listed.jobId, stderr: result.stderr });
      return { jobId: listed.jobId, action: "failed", reason: "broadcast_uncertain" };
    }
    // A clean, definite failure never broadcast — safe to retry next sweep.
    await deps.recordApplication(key, {
      jobId: listed.jobId,
      state: "failed",
      updatedAt: new Date().toISOString(),
    });
    deps.log("open_job_apply_failed", { jobId: listed.jobId, stderr: result.stderr });
    return { jobId: listed.jobId, action: "failed", reason: result.stderr ?? "apply_failed" };
  }

  // 6. Evidence persisted before the caller may treat the job as handled.
  await deps.recordApplication(key, {
    jobId: listed.jobId,
    state: "applied",
    transactionRef: result.transactionRef,
    updatedAt: new Date().toISOString(),
  });
  deps.log("open_job_applied", {
    jobId: listed.jobId,
    buyerAgentId: candidate.buyerAgentId,
    tokenAmount: candidate.tokenAmount,
    tokenSymbol: candidate.tokenSymbol,
    transactionRef: result.transactionRef,
    providerAgentId: SELLER_AGENT_ID,
  });
  return { jobId: listed.jobId, action: "applied", transactionRef: result.transactionRef };
}
