/**
 * Executes an official OKX system event end-to-end, and is the direct fix for
 * the audited acknowledgement defect.
 *
 * The defect
 * ----------
 * The previous path (provider-worker.acknowledgeProviderEvent) ran
 * `onchainos agent next-action` and then did:
 *
 *     if (result.ok) store.acknowledge(...)
 *
 * `next-action` exiting 0 only means the CLI *printed instructions*. Its stdout
 * is instructional prose for a reasoning agent — it is not an action, and
 * nothing had executed it. So every system event was permanently marked done
 * having accomplished nothing, and because acknowledge() suppresses replay, the
 * work was lost silently and irrecoverably. (In production the function was
 * never even wired in — it had no caller outside tests — so `next-action` never
 * ran at all.)
 *
 * The fix
 * -------
 * `instruction_fetched` is a distinct NON-acknowledgeable state. Acknowledgement
 * is gated on `mayAcknowledge()`, which admits only `action_confirmed` (the
 * required action genuinely completed and was confirmed against authoritative
 * state) or `terminal_failure` (an honest, recorded dead end). Anything else
 * stays replayable.
 *
 * Ordering guarantee: evidence is persisted BEFORE acknowledgement, never after,
 * so a crash between the two replays the event rather than losing it.
 */
import { createHash } from "node:crypto";

import {
  actionAlreadyCompleted,
  authorizeAction,
  classifyInbound,
  decideRetry,
  mayAcknowledge,
  requiresReconciliation,
  SELLER_AGENT_ID,
  type AuthoritativeTask,
  type EventLifecycleState,
  type InboundEnvelope,
  type ProposedAction,
} from "./system-event-route";

export interface ActionEvidence {
  state: EventLifecycleState;
  instructionDigest?: string;
  modelInvocationId?: string;
  action?: ProposedAction;
  transactionRef?: string;
  xmtpMessageId?: string;
  error?: string;
  attempts: number;
  /**
   * Earliest time this event may be retried, ISO-8601. Set from
   * `decideRetry`'s own computed delay on a retryable failure; the recovery
   * scan skips the record until it passes. See Incident #18 in
   * system-event-route.ts.
   */
  retryAfterIso?: string;
}

/** Durable, process-safe ledger. Implemented over the /persistent volume. */
export interface ActionLedger {
  /** Returns existing evidence for this event, if any. */
  get(eventId: string): ActionEvidence | undefined;
  /** Persists evidence. MUST be durable before the caller acknowledges. */
  put(eventId: string, evidence: ActionEvidence): void;
  /**
   * Process-safe exclusive claim. Returns false when another runtime loop
   * already holds this event, so two loops cannot execute the same event.
   */
  tryLock(eventId: string): boolean;
  unlock(eventId: string): void;
}

/** Fetches the authoritative next-action instruction prose. */
export type InstructionFetcher = (input: {
  event: string;
  jobId: string;
  envelope: InboundEnvelope;
}) => Promise<{ ok: boolean; stdout: string; stderr: string; status?: number }>;

/** Reads authoritative task detail — the record actions are checked against. */
export type TaskReader = (jobId: string) => Promise<AuthoritativeTask | undefined>;

/** Runs the pinned-model turn and returns the actions it proposes. */
export type ModelTurn = (input: {
  instruction: string;
  jobId: string;
  /**
   * The original validated envelope. Needed because some playbooks are
   * REDIRECTS rather than instructions — `wakeup_notify`'s says the real
   * business state lives in `message.jobStatus` and the playbook must be
   * re-requested with it. The value is read from the envelope, never from
   * the playbook prose, so generated text can never steer the next action.
   */
  envelope?: InboundEnvelope;
}) => Promise<{
  ok: boolean;
  invocationId?: string;
  actions: ProposedAction[];
  status?: number;
  retryAfterSeconds?: number;
  error?: string;
}>;

/** Executes one authorized action. */
export type ActionRunner = (action: ProposedAction) => Promise<{
  ok: boolean;
  transactionRef?: string;
  broadcast: boolean;
  error?: string;
}>;

/** Reconciles an action whose outcome is unknown after a broadcast. */
export type Reconciler = (input: {
  jobId: string;
  action: ProposedAction;
}) => Promise<{ completed: boolean; transactionRef?: string }>;

/**
 * Publishes the buyer-facing status over XMTP. Separate from the action so a
 * failed publication retries the MESSAGE only — never the on-chain action.
 */
export type StatusPublisher = (input: {
  jobId: string;
  state: EventLifecycleState;
  transactionRef?: string;
}) => Promise<{ ok: boolean; messageId?: string; error?: string }>;

export interface ExecuteDeps {
  ledger: ActionLedger;
  fetchInstruction: InstructionFetcher;
  readTask: TaskReader;
  runModel: ModelTurn;
  runAction: ActionRunner;
  reconcile: Reconciler;
  publishStatus: StatusPublisher;
}

export interface ExecuteResult {
  state: EventLifecycleState;
  acknowledged: boolean;
  reason: string;
  evidence?: ActionEvidence;
}

export function instructionDigest(instruction: string): string {
  return createHash("sha256").update(instruction).digest("hex").slice(0, 32);
}

/**
 * Runs one system event to a terminal-or-replayable outcome.
 *
 * Never throws for expected conditions — a caller that treats a thrown error as
 * "handled" is how events get lost. Every exit path returns an explicit state.
 */
export async function executeSystemEvent(
  eventId: string,
  envelope: InboundEnvelope,
  deps: ExecuteDeps
): Promise<ExecuteResult> {
  const classification = classifyInbound(envelope);
  if (classification.kind !== "okx_system_event") {
    // Not ours. Emphatically not an error, and never acknowledged as one —
    // buyer chat belongs to the deterministic bridge.
    return {
      state: "terminal_failure",
      acknowledged: false,
      reason: `not_a_system_event:${classification.kind}`,
    };
  }

  const { jobId } = classification;

  if (!deps.ledger.tryLock(eventId)) {
    return { state: "discovered", acknowledged: false, reason: "locked_by_another_loop" };
  }

  try {
    const prior = deps.ledger.get(eventId);

    // Already finished in an earlier run — never re-execute, never re-charge.
    if (prior && mayAcknowledge(prior.state)) {
      return {
        state: prior.state,
        acknowledged: true,
        reason: "already_completed",
        evidence: prior,
      };
    }

    // The action already landed in an earlier run, but the turn did not finish
    // (status never published). Resume at PUBLICATION — never re-run the
    // action. This is what makes a lost XMTP response safe to retry.
    if (prior && actionAlreadyCompleted(prior.state)) {
      return publishAndAcknowledge(deps, eventId, jobId, prior, "resumed_at_publication");
    }

    // Crash after broadcast: the action may or may not have landed. Reconcile
    // against authoritative state — never blind-retry an on-chain action.
    if (prior && requiresReconciliation(prior.state) && prior.action) {
      const outcome = await deps.reconcile({ jobId, action: prior.action });
      if (outcome.completed) {
        const confirmed: ActionEvidence = {
          ...prior,
          state: "action_confirmed",
          transactionRef: outcome.transactionRef ?? prior.transactionRef,
        };
        deps.ledger.put(eventId, confirmed);
        return publishAndAcknowledge(
          deps,
          eventId,
          jobId,
          confirmed,
          "reconciled_existing_action"
        );
      }
      // Genuinely did not land — fall through and retry from a known state.
    }

    const attempts = (prior?.attempts ?? 0) + 1;

    const instruction = await deps.fetchInstruction({
      event: classification.event,
      jobId,
      envelope,
    });
    if (!instruction.ok) {
      return persistRetryable(deps, eventId, attempts, "next_action_failed", instruction.status);
    }

    // The pivotal state. Reached whenever next-action exits 0 — and explicitly
    // NOT acknowledgeable, because printing instructions is not doing them.
    const digest = instructionDigest(instruction.stdout);
    deps.ledger.put(eventId, {
      state: "instruction_fetched",
      instructionDigest: digest,
      attempts,
    });

    const task = await deps.readTask(jobId);
    if (!task) {
      return persistRetryable(deps, eventId, attempts, "task_detail_unavailable");
    }

    const turn = await deps.runModel({ instruction: instruction.stdout, jobId, envelope });
    if (!turn.ok) {
      const decision = decideRetry({
        status: turn.status,
        attempts,
        retryAfterSeconds: turn.retryAfterSeconds,
      });
      // `decision.reason` describes the RETRY CLASS (retryable vs terminal),
      // not what actually went wrong. Recording it alone discards the turn's
      // own diagnosis, and every failure in this branch then reads as an
      // indistinguishable `internal_failure_retryable`.
      //
      // That opacity is not cosmetic: it hid a live production defect for the
      // entire life of job 0x22a2…. The turn was reporting a precise cause
      // (an unparseable repository URL) on every one of 15 attempts, four
      // separate times, and none of it reached the ledger or the logs. The
      // cause of a failure and its retry class are different facts and both
      // are now kept.
      const cause = turn.error ? `${decision.reason}:${turn.error}` : decision.reason;
      if (!decision.retry) {
        return persistTerminal(deps, eventId, attempts, `model_turn_terminal:${cause}`);
      }
      return persistRetryable(deps, eventId, attempts, `model_turn_retryable:${cause}`);
    }

    if (turn.actions.length === 0) {
      // A turn that proposes nothing has not done the work. Recording it as
      // success is precisely the false-acknowledgement bug being fixed.
      return persistRetryable(deps, eventId, attempts, "model_proposed_no_action");
    }

    let lastTransactionRef: string | undefined;
    for (const action of turn.actions) {
      const verdict = authorizeAction(action, task, jobId);
      if (!verdict.allowed) {
        // A refused action is terminal, not retryable: replaying it would just
        // be refused again, and it means the turn tried something out of bounds.
        return persistTerminal(
          deps,
          eventId,
          attempts,
          `action_refused:${verdict.reason}`,
          turn.invocationId
        );
      }

      deps.ledger.put(eventId, {
        state: "action_authorized",
        instructionDigest: digest,
        modelInvocationId: turn.invocationId,
        action,
        attempts,
      });

      const outcome = await deps.runAction(action);

      if (!outcome.ok && outcome.broadcast) {
        // Signed and sent, outcome unknown. Persist BEFORE returning so a crash
        // here still leaves a reconcilable record rather than a silent re-send.
        const evidence: ActionEvidence = {
          state: "action_broadcast",
          instructionDigest: digest,
          modelInvocationId: turn.invocationId,
          action,
          transactionRef: outcome.transactionRef,
          attempts,
          error: outcome.error,
        };
        deps.ledger.put(eventId, evidence);
        return {
          state: "action_broadcast",
          acknowledged: false,
          reason: "broadcast_outcome_unknown",
          evidence,
        };
      }

      if (!outcome.ok) {
        return persistRetryable(deps, eventId, attempts, `action_failed:${outcome.error ?? "unknown"}`);
      }

      lastTransactionRef = outcome.transactionRef ?? lastTransactionRef;
    }

    const evidence: ActionEvidence = {
      state: "action_confirmed",
      instructionDigest: digest,
      modelInvocationId: turn.invocationId,
      action: turn.actions[turn.actions.length - 1],
      transactionRef: lastTransactionRef,
      attempts,
    };
    // Evidence first, acknowledgement second — never the reverse. If the
    // process dies here, the resume path above picks up at publication and
    // does NOT re-run the action.
    deps.ledger.put(eventId, evidence);
    return publishAndAcknowledge(deps, eventId, jobId, evidence, "action_completed");
  } finally {
    deps.ledger.unlock(eventId);
  }
}

/**
 * Publishes the buyer-facing status, then acknowledges.
 *
 * A publication failure is retryable and leaves the event UNacknowledged, so it
 * is replayed — but it replays into the `actionAlreadyCompleted` branch, which
 * skips straight back here. The action can therefore never run twice no matter
 * how many times publication fails.
 */
async function publishAndAcknowledge(
  deps: ExecuteDeps,
  eventId: string,
  jobId: string,
  evidence: ActionEvidence,
  reason: string
): Promise<ExecuteResult> {
  deps.ledger.put(eventId, { ...evidence, state: "response_pending" });

  const published = await deps.publishStatus({
    jobId,
    state: "action_confirmed",
    transactionRef: evidence.transactionRef,
  });

  if (!published.ok) {
    const pending: ActionEvidence = {
      ...evidence,
      state: "response_pending",
      error: published.error ?? "xmtp_publish_failed",
    };
    deps.ledger.put(eventId, pending);
    return {
      state: "response_pending",
      acknowledged: false,
      reason: "status_publication_failed_action_preserved",
      evidence: pending,
    };
  }

  const acknowledged: ActionEvidence = {
    ...evidence,
    state: "acknowledged",
    xmtpMessageId: published.messageId,
  };
  deps.ledger.put(eventId, acknowledged);
  return {
    state: "acknowledged",
    acknowledged: mayAcknowledge("acknowledged"),
    reason,
    evidence: acknowledged,
  };
}

function persistRetryable(
  deps: ExecuteDeps,
  eventId: string,
  attempts: number,
  reason: string,
  status?: number
): ExecuteResult {
  const decision = decideRetry({ status, attempts });
  const state: EventLifecycleState = decision.retry ? "retryable_failure" : "terminal_failure";
  /**
   * Incident #18: `decideRetry` has always computed a delay and no caller has
   * ever honoured it, so a failing event replayed at full poll speed and, on
   * restart, immediately. Recording it on the event's own ledger record turns
   * it into a durable, PER-EVENT quarantine: `pendingForRecovery` skips a
   * record until its `retryAfterIso` has passed, across restarts.
   *
   * Scoped to the one failing event and nothing else — a healthy event
   * arriving a second later is completely unaffected, which is the whole
   * point of replacing the global suspension switch.
   *
   * Only set when the event is genuinely going to be retried. A terminal
   * record is never replayed, so a defer timestamp on one would be
   * meaningless, and leaving it absent keeps the record honest.
   */
  const retryAfterIso = decision.retry
    ? new Date(Date.now() + decision.delayMs).toISOString()
    : undefined;
  const evidence: ActionEvidence = { state, attempts, error: reason, retryAfterIso };
  deps.ledger.put(eventId, evidence);
  return { state, acknowledged: mayAcknowledge(state), reason, evidence };
}

function persistTerminal(
  deps: ExecuteDeps,
  eventId: string,
  attempts: number,
  reason: string,
  modelInvocationId?: string
): ExecuteResult {
  const evidence: ActionEvidence = {
    state: "terminal_failure",
    attempts,
    error: reason,
    modelInvocationId,
  };
  deps.ledger.put(eventId, evidence);
  return { state: "terminal_failure", acknowledged: true, reason, evidence };
}

/** Guard for the identity this executor is permitted to act as. */
export function assertSellerIdentity(agentId: string): void {
  if (agentId !== SELLER_AGENT_ID) throw new Error("seller_agent_identity_mismatch");
}
