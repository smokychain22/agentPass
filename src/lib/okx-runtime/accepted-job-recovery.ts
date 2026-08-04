/**
 * Recovery for an ACCEPTED job that never produced a deliverable.
 *
 * `reconcileOpenJobs` closes the gap for jobs stuck at `created` (status 0):
 * a `job_asp_selected` that was never delivered leaves a real, applyable job
 * with no event to replay. It deliberately refuses everything past `created`,
 * because for an already-applied job "apply again" is a duplicate on-chain
 * action.
 *
 * But there is a second, symmetric gap it cannot close. Once the buyer runs
 * `confirm-accept` the job moves to `accepted` (status 1) and escrow is
 * funded. From then on the ONLY trigger that produces the deliverable is an
 * official `job_accepted` system event. If that event was never delivered,
 * arrived while the machine was down, or was dropped between the gateway and
 * the inbox, the job sits at `accepted` — escrow funded, buyer waiting,
 * nothing pending — and no sweep in this runtime will ever touch it. That is
 * exactly the live state of the funded job this module was written for.
 *
 * This is the reconciler for that state. It compares desired state (an
 * accepted job of ours should have a deliverable) against observed state (it
 * has none) and closes the gap, which makes it naturally idempotent and safe
 * to run repeatedly.
 *
 * ## Why this is not a fabricated event
 *
 * It would be trivial — and wrong — to write a `job_accepted` envelope into
 * the system-event spool and let the normal path pick it up. That would be
 * forging evidence that the network delivered something it did not, and it
 * would launder a synthetic message through `validateOfficialEnvelope` and
 * into the durable event ledger, corrupting the one record that is supposed
 * to describe what OKX actually sent.
 *
 * So this module never writes to the spool and never touches the event
 * ledger. Instead it:
 *
 *   1. READS authoritative state from OKX (`agent status` + `common
 *      context`) and refuses unless that state is, on its own evidence,
 *      `accepted` and ours;
 *   2. asks the official CLI what to do about the state it just OBSERVED
 *      (`agent next-action`, whose documented contract is a stateless query —
 *      "copy the envelope through, the CLI parses out whatever it needs");
 *   3. hands that real playbook to the SAME `createDeterministicTurn` the
 *      event path uses, and executes the actions it returns through the same
 *      authorization boundary.
 *
 * The `{event, jobId}` descriptor passed to `next-action` is derived from
 * verified authoritative status, never invented: if OKX does not report the
 * job as `accepted`, no descriptor is built and nothing runs.
 *
 * ## Fail-closed
 *
 * Every gate below refuses on ABSENT evidence, not just on contrary evidence.
 * An unreadable task, an unknown deliverable count, an unverifiable escrow or
 * an inconclusive GitHub probe all refuse. The cost of refusing is that a
 * human runs the command again; the cost of proceeding on a half-known job is
 * a duplicate PR or a second delivery against real escrowed funds.
 */
import { REPODIET_OKX_SERVICES } from "./service-selection";
import {
  SELLER_AGENT_ID,
  type AuthoritativeTask,
  type InboundEnvelope,
  type ProposedAction,
} from "./system-event-route";
import type { ApplyCandidate } from "./provider-apply";
import type { InstructionFetcher, ModelTurn } from "./provider-event-executor";
import { cleanupBranchForJob } from "./deterministic-turn";
import { parseGitHubUrl } from "@/lib/github/parse-github-url";

/** Protocol status for a job the buyer has confirmed and escrowed. */
export const STATUS_ACCEPTED = 1;

const AMOUNT_PATTERN = /^\d+(\.\d+)?$/;

/**
 * The counterparty this recovery path is pinned to.
 *
 * The open-job sweep derives eligibility purely from the binding OKX
 * published, because it must work for any future buyer. This path is
 * deliberately narrower: it acts on a job that is ALREADY funded, so the
 * blast radius of a mistake is someone else's escrowed money. It therefore
 * refuses any job whose buyer is not the pinned production counterparty, in
 * addition to every check the open-job gate already makes.
 *
 * That is also what keeps this path off reviewer-owned probe jobs: the seven
 * live probes carry a different buyer AND a price five orders of magnitude
 * below the listing, and either fact alone is disqualifying.
 */
export const REPODIET_A2A_BUYER_AGENT_ID = "10466";

export interface AcceptedJobRecoveryPolicy {
  aspAgentId: string;
  buyerAgentId: string;
  serviceId: string;
  fee: string;
  tokenSymbol: string;
  tokenAddress: string;
  chainIndex: number;
}

export const REPODIET_A2A_RECOVERY_POLICY: AcceptedJobRecoveryPolicy = {
  aspAgentId: SELLER_AGENT_ID,
  buyerAgentId: REPODIET_A2A_BUYER_AGENT_ID,
  serviceId: REPODIET_OKX_SERVICES.a2a.serviceId,
  fee: REPODIET_OKX_SERVICES.a2a.fee,
  tokenSymbol: REPODIET_OKX_SERVICES.a2a.tokenSymbol,
  tokenAddress: REPODIET_OKX_SERVICES.a2a.tokenAddress,
  chainIndex: REPODIET_OKX_SERVICES.a2a.chainIndex,
};

/**
 * Everything observed about a job, gathered before any decision is made.
 *
 * `undefined` means NOT KNOWN and is always refused — it never falls back to
 * a permissive default. The types make that explicit so a future field cannot
 * be added as an optional boolean and silently read as "fine".
 */
export interface AcceptedJobObservation {
  jobId: string;
  /** `undefined` when authoritative state could not be read at all. */
  task?: (AuthoritativeTask & Partial<ApplyCandidate>) | undefined;
  /** Deliverables already submitted for this job. `undefined` = unreadable. */
  deliverableCount?: number | undefined;
  /** Normalized repository URL from the task context. */
  repositoryUrl?: string | undefined;
  /** Authenticated GitHub App installation access. `undefined` = inconclusive. */
  installationAccess?: boolean | undefined;
  /** An open PR already on the deterministic branch, if any. */
  existingPrUrl?: string | undefined;
}

export type RecoveryVerdict =
  | {
      eligible: true;
      /** Present when a prior attempt already opened the deterministic PR. */
      reusePrUrl?: string;
      repositoryUrl: string;
      cleanupBranch: string;
    }
  | { eligible: false; reason: string };

/**
 * The whole decision, as one pure function.
 *
 * Pure so every branch is directly unit-testable without a network, a CLI, a
 * clock or a repository — the gates that protect real escrowed funds are
 * exactly the code that most needs to be cheap to test exhaustively.
 */
export function assessAcceptedJobRecovery(
  observation: AcceptedJobObservation,
  policy: AcceptedJobRecoveryPolicy = REPODIET_A2A_RECOVERY_POLICY
): RecoveryVerdict {
  const { jobId, task } = observation;

  if (!/^0x[0-9a-f]{64}$/i.test(jobId)) {
    return { eligible: false, reason: "job_id_malformed" };
  }

  // --- authoritative state -------------------------------------------------
  // Absence of a reading is never evidence of a benign state.
  if (!task) {
    return { eligible: false, reason: "authoritative_state_unavailable" };
  }
  if (task.jobId.toLowerCase() !== jobId.toLowerCase()) {
    return { eligible: false, reason: "authoritative_job_id_mismatch" };
  }

  // --- lifecycle -----------------------------------------------------------
  // Anything other than exactly `accepted` is refused. Below 1 the open-job
  // sweep owns it; at or above 2 the job has already been submitted,
  // completed, refused, disputed or settled and delivering again would be a
  // duplicate submission against a job that has moved on.
  if (task.statusCode !== STATUS_ACCEPTED) {
    return { eligible: false, reason: `status_not_accepted:${task.statusCode}` };
  }

  // --- identity ------------------------------------------------------------
  if (task.aspAgentId !== policy.aspAgentId) {
    return { eligible: false, reason: "not_designated_provider" };
  }
  if (!task.buyerAgentId) {
    return { eligible: false, reason: "buyer_unknown" };
  }
  if (task.buyerAgentId !== policy.buyerAgentId) {
    // Keeps this path off reviewer-owned and unrelated jobs.
    return { eligible: false, reason: `buyer_not_pinned_counterparty:${task.buyerAgentId}` };
  }
  if (task.buyerAgentId === policy.aspAgentId) {
    return { eligible: false, reason: "buyer_is_self" };
  }

  // --- service -------------------------------------------------------------
  // Matched when OKX exposes one; inferred from escrow corroboration when it
  // does not, exactly as the open-job gate does — verified live, none of
  // `active-tasks`, `agent status` or `common context` carries a serviceId,
  // so requiring it outright would make this path a permanent no-op.
  if (task.serviceId !== undefined) {
    if (task.serviceId !== policy.serviceId) {
      return { eligible: false, reason: `service_not_a2a:${task.serviceId}` };
    }
  } else if (task.escrowPayment !== true) {
    return { eligible: false, reason: "service_unverifiable" };
  }
  if (task.operation !== undefined && task.operation !== REPODIET_OKX_SERVICES.a2a.operation) {
    return { eligible: false, reason: `operation_not_cleanup:${task.operation}` };
  }

  // --- escrow --------------------------------------------------------------
  // `paymentType=1` on a job OKX reports as `accepted` is the protocol's own
  // evidence that escrow is funded: `confirm-accept` is what moves a job to
  // `accepted`, and it funds escrow in the same transaction. An accepted job
  // with no escrow corroboration is refused rather than assumed.
  if (task.escrowPayment !== true) {
    return { eligible: false, reason: "escrow_not_funded" };
  }

  // --- price / asset -------------------------------------------------------
  if (!AMOUNT_PATTERN.test(task.tokenAmount ?? "")) {
    return { eligible: false, reason: `token_amount_malformed:${task.tokenAmount}` };
  }
  // Numeric so "1", "1.0" and "1.00" are the same price.
  if (Number(task.tokenAmount) !== Number(policy.fee)) {
    return { eligible: false, reason: `price_not_registered:${task.tokenAmount}!=${policy.fee}` };
  }
  if (!task.tokenSymbol || task.tokenSymbol.toUpperCase() !== policy.tokenSymbol) {
    return { eligible: false, reason: `token_symbol_not_registered:${task.tokenSymbol}` };
  }
  if (
    task.tokenAddress !== undefined &&
    task.tokenAddress.toLowerCase() !== policy.tokenAddress
  ) {
    return { eligible: false, reason: `token_asset_not_registered:${task.tokenAddress}` };
  }
  if (task.chainIndex !== undefined && task.chainIndex !== policy.chainIndex) {
    return { eligible: false, reason: `network_not_x_layer:${task.chainIndex}` };
  }

  // --- existing deliverable ------------------------------------------------
  // The single most important duplicate guard: a job that already has a
  // deliverable must never be delivered again, and an unreadable deliverable
  // list is treated as "might already exist".
  if (observation.deliverableCount === undefined) {
    return { eligible: false, reason: "deliverable_state_uncertain" };
  }
  if (observation.deliverableCount > 0) {
    return { eligible: false, reason: "deliverable_already_exists" };
  }

  // --- repository ----------------------------------------------------------
  if (!observation.repositoryUrl) {
    return { eligible: false, reason: "repository_url_unresolved" };
  }
  const parsed = parseGitHubUrl(observation.repositoryUrl);
  if (!parsed) {
    return { eligible: false, reason: "repository_url_invalid" };
  }
  if (observation.installationAccess !== true) {
    return { eligible: false, reason: "github_installation_access_unavailable" };
  }

  return {
    eligible: true,
    reusePrUrl: observation.existingPrUrl,
    repositoryUrl: observation.repositoryUrl,
    cleanupBranch: cleanupBranchForJob(jobId),
  };
}

export interface AcceptedJobRecoveryDeps {
  /** Authoritative status + context enrichment (`createOpenJobTaskReader`). */
  readTask: (
    jobId: string
  ) => Promise<(AuthoritativeTask & Partial<ApplyCandidate>) | undefined>;
  /** Official deliverable list. Must reject/throw rather than report zero on failure. */
  listDeliverables: (jobId: string) => Promise<number>;
  /** Authenticated installation probe for the resolved repository. */
  hasInstallationAccess: (owner: string, repo: string) => Promise<boolean>;
  /** Open PRs already on the deterministic branch. */
  findExistingPr: (
    owner: string,
    repo: string,
    branch: string
  ) => Promise<string | undefined>;
  /** Official `agent next-action` query. */
  fetchInstruction: InstructionFetcher;
  /** The SAME deterministic turn the event path uses. */
  runTurn: ModelTurn;
  /** Official CLI action runner, already bounded by the authorization boundary. */
  runAction: (action: ProposedAction) => Promise<{
    ok: boolean;
    transactionRef?: string;
    error?: string;
    uncertain?: boolean;
  }>;
  log: (event: string, fields: Record<string, unknown>) => void;
  /** When true, assess and report but never run an action. */
  dryRun?: boolean;
  policy?: AcceptedJobRecoveryPolicy;
}

export type AcceptedJobRecoveryOutcome =
  | { action: "recovered"; jobId: string; actionsRun: number; transactionRefs: string[] }
  | { action: "skipped"; jobId: string; reason: string }
  | {
      action: "dry_run";
      jobId: string;
      repositoryUrl: string;
      cleanupBranch: string;
      reusePrUrl?: string;
    }
  | { action: "failed"; jobId: string; reason: string };

/**
 * Builds the descriptor handed to `next-action`.
 *
 * Shaped like the `message` object of an official envelope because that is
 * the CLI's documented input contract, but it is a QUERY about observed
 * state, not a claim that a message arrived: it is only ever built after
 * `assessAcceptedJobRecovery` has confirmed, from OKX's own reading, that the
 * job really is accepted. It is never persisted to the spool or the event
 * ledger.
 */
export function buildRecoveryQueryEnvelope(jobId: string): InboundEnvelope {
  return {
    agentId: SELLER_AGENT_ID,
    message: { event: "job_accepted", jobId },
  } as InboundEnvelope;
}

/**
 * Recovers exactly one accepted-but-undelivered job.
 *
 * Sequential and single-job by design: the operator names the job, so there
 * is no listing step that could sweep an unrelated one in, and no concurrent
 * broadcast that could contend for the wallet nonce.
 */
export async function recoverAcceptedJob(
  jobId: string,
  deps: AcceptedJobRecoveryDeps
): Promise<AcceptedJobRecoveryOutcome> {
  const policy = deps.policy ?? REPODIET_A2A_RECOVERY_POLICY;

  // --- observe -------------------------------------------------------------
  let task: (AuthoritativeTask & Partial<ApplyCandidate>) | undefined;
  try {
    task = await deps.readTask(jobId);
  } catch (err) {
    const reason = `authoritative_read_failed:${errText(err)}`;
    deps.log("accepted_job_recovery_skipped", { jobId, reason });
    return { action: "skipped", jobId, reason };
  }

  let deliverableCount: number | undefined;
  try {
    deliverableCount = await deps.listDeliverables(jobId);
  } catch {
    // Left undefined — the gate refuses on an unknown deliverable count.
    deliverableCount = undefined;
  }

  const repositoryUrl = task?.repositoryUrl;
  const parsed = repositoryUrl ? parseGitHubUrl(repositoryUrl) : undefined;

  let installationAccess: boolean | undefined;
  if (parsed) {
    try {
      installationAccess = await deps.hasInstallationAccess(parsed.owner, parsed.repo);
    } catch {
      installationAccess = undefined;
    }
  }

  const cleanupBranch = cleanupBranchForJob(jobId);
  let existingPrUrl: string | undefined;
  if (parsed) {
    try {
      existingPrUrl = await deps.findExistingPr(parsed.owner, parsed.repo, cleanupBranch);
    } catch {
      existingPrUrl = undefined;
    }
  }

  // --- decide --------------------------------------------------------------
  const verdict = assessAcceptedJobRecovery(
    { jobId, task, deliverableCount, repositoryUrl, installationAccess, existingPrUrl },
    policy
  );

  if (!verdict.eligible) {
    deps.log("accepted_job_recovery_skipped", { jobId, reason: verdict.reason });
    return { action: "skipped", jobId, reason: verdict.reason };
  }

  deps.log("accepted_job_recovery_eligible", {
    jobId,
    repositoryUrl: verdict.repositoryUrl,
    cleanupBranch: verdict.cleanupBranch,
    reusingExistingPr: verdict.reusePrUrl ?? null,
  });

  /**
   * Stops BEFORE the deterministic turn, not after.
   *
   * The turn is not a planner — it creates the cleanup pull request as part of
   * producing its actions (see deterministic-turn.ts: it calls
   * `createCleanupPullRequest` and only then proposes `agent deliver` with the
   * resulting URL). Running it to "preview" would therefore write a real
   * branch and a real PR to a real repository, which is the opposite of what
   * `--dry-run` promises. So a dry run reports the verdict and the exact
   * targets it would act on, and performs no repository work at all.
   */
  if (deps.dryRun) {
    deps.log("accepted_job_recovery_dry_run", {
      jobId,
      repositoryUrl: verdict.repositoryUrl,
      cleanupBranch: verdict.cleanupBranch,
      reusePrUrl: verdict.reusePrUrl ?? null,
      note: "eligible; stopped before the deterministic turn so no branch or PR is created",
    });
    return {
      action: "dry_run",
      jobId,
      repositoryUrl: verdict.repositoryUrl,
      cleanupBranch: verdict.cleanupBranch,
      reusePrUrl: verdict.reusePrUrl,
    };
  }

  // --- official playbook for the OBSERVED state ----------------------------
  const envelope = buildRecoveryQueryEnvelope(jobId);
  let instruction: { ok: boolean; stdout: string; stderr: string };
  try {
    instruction = await deps.fetchInstruction({ event: "job_accepted", jobId, envelope });
  } catch (err) {
    const reason = `next_action_failed:${errText(err)}`;
    deps.log("accepted_job_recovery_failed", { jobId, reason });
    return { action: "failed", jobId, reason };
  }
  if (!instruction.ok) {
    const reason = "next_action_unavailable";
    deps.log("accepted_job_recovery_failed", { jobId, reason, stderr: instruction.stderr });
    return { action: "failed", jobId, reason };
  }

  // --- the same deterministic turn the event path uses ---------------------
  const turn = await deps.runTurn({ instruction: instruction.stdout, jobId, envelope });
  if (!turn.ok) {
    const reason = turn.error ?? "deterministic_turn_failed";
    deps.log("accepted_job_recovery_failed", { jobId, reason });
    return { action: "failed", jobId, reason };
  }

  // --- execute -------------------------------------------------------------
  const transactionRefs: string[] = [];
  let actionsRun = 0;
  for (const action of turn.actions) {
    const result = await deps.runAction(action);
    if (result.transactionRef) transactionRefs.push(result.transactionRef);
    if (!result.ok) {
      const reason = result.uncertain
        ? `action_outcome_uncertain:${action.command}`
        : `action_failed:${action.command}:${result.error ?? "unknown"}`;
      // An uncertain outcome must never be retried blindly — re-running the
      // recovery re-reads authoritative state, and a delivery that did land
      // will show up as an existing deliverable and refuse.
      deps.log("accepted_job_recovery_failed", { jobId, reason });
      return { action: "failed", jobId, reason };
    }
    actionsRun += 1;
  }

  deps.log("accepted_job_recovery_recovered", { jobId, actionsRun, transactionRefs });
  return { action: "recovered", jobId, actionsRun, transactionRefs };
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : "unknown_error";
}
