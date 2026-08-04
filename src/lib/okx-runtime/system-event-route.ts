/**
 * Narrow OKX system-event route: the ONLY path in this runtime that is
 * allowed to reach a model provider.
 *
 * Why this module exists
 * ----------------------
 * The OKX task state machine lives in the CLI (`onchainos agent next-action`),
 * and its output is a natural-language *instruction prompt* for a reasoning
 * agent — not a machine-readable action list. Verified directly against the
 * installed CLI: next-action returns prose containing conditional branches,
 * placeholder substitution, localization directives, and the explicit line
 * "Tool choice is outside the script's scope; the agent decides autonomously."
 * There is therefore no deterministic parse of it, and a model turn is
 * genuinely required to execute the official lifecycle.
 *
 * That is the ONLY thing a model is used for here. Ordinary buyer chat —
 * repository negotiation, findings, explicit file approval, cleanup planning,
 * PR delivery — stays 100% deterministic in openclaw-plugins/repodiet-a2a-bridge.
 * classifyInbound() below is the boundary that keeps those two worlds apart,
 * and it fails CLOSED: anything it cannot positively prove to be an official
 * system event is routed away from the model.
 *
 * The model proposes; this module disposes. Every action the model asks for is
 * re-checked here against the authoritative task detail before it is allowed to
 * run. The model never gets to pick the job, the counterparty, the amount, or
 * the token.
 */

/** Authoritative inbound envelope shapes, per the okx-ai skill contract. */
export interface InboundEnvelope {
  agentId?: string;
  msgType?: string;
  message?: {
    source?: string;
    event?: string;
    jobId?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type InboundClass =
  /** Official OKX system event — the only class routed to the model. */
  | { kind: "okx_system_event"; event: string; jobId: string }
  /** Agent-to-agent task chat — deterministic bridge owns this. */
  | { kind: "buyer_chat"; reason: string }
  /** Anything unproven. Fails closed, never reaches the model. */
  | { kind: "unroutable"; reason: string };

/**
 * The seller identity this runtime is permitted to act as. Hard-coded rather
 * than configurable: a misconfigured agent id here would mean signing on-chain
 * actions as the wrong provider.
 */
export const SELLER_AGENT_ID = "9636";

/**
 * Deterministic classifier. Returns `okx_system_event` ONLY when every
 * authoritative marker is present and correct; everything else is pushed away
 * from the model path.
 *
 * Deliberately structural, never text matching: an inbound buyer message whose
 * body happens to contain the words "system" or "job_accepted" must not be able
 * to talk its way onto the model route, and a real system event must not be
 * missed because its prose changed.
 */
export function classifyInbound(envelope: InboundEnvelope): InboundClass {
  if (!envelope || typeof envelope !== "object") {
    return { kind: "unroutable", reason: "envelope_not_an_object" };
  }

  // Agent-to-agent chat is explicitly the deterministic bridge's territory.
  // Checked FIRST so a chat envelope can never fall through into the system
  // branch on a coincidentally-shaped `message`.
  if (envelope.msgType === "a2a-agent-chat") {
    return { kind: "buyer_chat", reason: "msgType=a2a-agent-chat" };
  }

  const message = envelope.message;
  if (!message || typeof message !== "object") {
    return { kind: "unroutable", reason: "missing_message_object" };
  }
  if (message.source !== "system") {
    return { kind: "unroutable", reason: `message.source=${String(message.source)}` };
  }

  const event = typeof message.event === "string" ? message.event.trim() : "";
  if (!event) return { kind: "unroutable", reason: "missing_event" };

  const jobId = typeof message.jobId === "string" ? message.jobId.trim() : "";
  if (!isJobId(jobId)) return { kind: "unroutable", reason: "missing_or_malformed_job_id" };

  // A system event addressed to a different agent must never be executed as
  // agent 9636. `agentId` is optional on some envelopes; when present it is
  // authoritative and must match.
  if (envelope.agentId !== undefined && String(envelope.agentId) !== SELLER_AGENT_ID) {
    return { kind: "unroutable", reason: "agent_id_mismatch" };
  }

  return { kind: "okx_system_event", event, jobId };
}

/** 0x-prefixed 32-byte task id, the only job id shape the protocol emits. */
export function isJobId(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
}

/**
 * Authoritative task facts, read from `onchainos agent status` / the
 * next-action task-fields block. This is the trusted record an action is
 * checked against — never the model's recollection of it.
 */
export interface AuthoritativeTask {
  jobId: string;
  aspAgentId: string;
  buyerAgentId: string;
  statusCode: number;
  tokenAmount: string;
  tokenSymbol: string;
}

/** An action the model turn wants to perform. */
export interface ProposedAction {
  command: string;
  args: readonly string[];
}

export type AuthorizationVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Commands the system-event route may run. Everything else is refused.
 *
 * Deliberately excludes every identity/listing/marketplace mutation
 * (`agent create`, `agent update`, `agent activate`, `agent upload`,
 * `create-task`, `set-asp`, …). Agent 9636's listing is under review; a model
 * turn must not be able to resubmit it, re-register it, mint services, or
 * publish new tasks. It also excludes buyer-side settlement calls
 * (`confirm-accept`, `complete`, `close`), which belong to the buyer, not the
 * provider — the seller runtime must never fund or release its own escrow.
 */
export const ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  "agent next-action",
  "agent status",
  "agent apply",
  "agent deliver",
  "agent user-notify",
  "agent payment",
  "okx-a2a xmtp-send",
]);

/**
 * `agent apply` is an on-chain, irreversible, gas-spending broadcast
 * ("apply API → sign → broadcast"), and it is the ONE allowlisted command
 * that is only ever valid from a single status. Applying to a job that has
 * already moved past `created` would be a duplicate application against a
 * task that has moved on, so the status rule is pinned here rather than left
 * to the general non-actionable set — which permits both 0 and 1.
 */
const APPLY_ONLY_STATUS = 0;

/** Terminal or otherwise non-actionable states — no action may run against them. */
const NON_ACTIONABLE_STATUS = new Set([2, 3, 4, 5, 6, 7, 8, 9]);

/**
 * The final authorization boundary. Deterministic, and applied to every action
 * the model proposes, after the model has spoken and before anything runs.
 */
export function authorizeAction(
  action: ProposedAction,
  task: AuthoritativeTask,
  expectedJobId: string
): AuthorizationVerdict {
  const command = action.command.trim();
  if (!ALLOWED_COMMANDS.has(command)) {
    return { allowed: false, reason: `command_not_allowlisted:${command}` };
  }

  // Argument arrays only — never an interpolated shell string. A single arg
  // carrying a shell metacharacter means something built a command line.
  for (const arg of action.args) {
    if (typeof arg !== "string") return { allowed: false, reason: "non_string_argument" };
    if (/[;&|`$><\n]/.test(arg)) {
      return { allowed: false, reason: "shell_metacharacter_in_argument" };
    }
  }

  if (task.jobId !== expectedJobId) {
    return { allowed: false, reason: "job_id_mismatch_with_event" };
  }
  // Never act on a job this runtime is not the designated provider for. This
  // is what keeps the route off reviewer-owned jobs without naming any
  // reviewer agent id: eligibility is derived from the binding, not a list.
  if (task.aspAgentId !== SELLER_AGENT_ID) {
    return { allowed: false, reason: "not_designated_provider" };
  }
  if (NON_ACTIONABLE_STATUS.has(task.statusCode)) {
    return { allowed: false, reason: `non_actionable_status:${task.statusCode}` };
  }
  if (command === "agent apply" && task.statusCode !== APPLY_ONLY_STATUS) {
    return { allowed: false, reason: `apply_status_not_open:${task.statusCode}` };
  }
  // Applying for free is irreversible and the CLI treats an empty/zero amount
  // as exactly that. The amount must be present and positive here, before the
  // generic authoritative-amount check below compares it to the task record.
  if (command === "agent apply") {
    const index = action.args.indexOf("--token-amount");
    if (index < 0) return { allowed: false, reason: "apply_token_amount_missing" };
    const amount = Number(action.args[index + 1]);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { allowed: false, reason: "apply_token_amount_not_positive" };
    }
  }

  // Any job id appearing in the args must be the event's job. Stops a model
  // turn from redirecting an authorized action onto a different task.
  for (const arg of action.args) {
    if (isJobId(arg) && arg.toLowerCase() !== expectedJobId.toLowerCase()) {
      return { allowed: false, reason: "argument_job_id_mismatch" };
    }
  }

  // Amount/token are protocol-owned. If the action names them they must equal
  // the authoritative task record exactly — the model never negotiates price.
  const amountIndex = action.args.indexOf("--token-amount");
  if (amountIndex >= 0 && action.args[amountIndex + 1] !== task.tokenAmount) {
    return { allowed: false, reason: "token_amount_not_authoritative" };
  }
  const symbolIndex = action.args.indexOf("--token-symbol");
  if (symbolIndex >= 0 && action.args[symbolIndex + 1] !== task.tokenSymbol) {
    return { allowed: false, reason: "token_symbol_not_authoritative" };
  }

  // Provider-side actions must be signed as 9636.
  const agentIndex = action.args.findIndex((a) => a === "--agent-id" || a === "--agentId");
  if (agentIndex >= 0 && action.args[agentIndex + 1] !== SELLER_AGENT_ID) {
    return { allowed: false, reason: "agent_id_not_seller" };
  }

  return { allowed: true };
}

/**
 * Lifecycle of a single system event in the durable ledger.
 *
 * The audited defect this replaces: the previous worker acknowledged an event
 * whenever `next-action` exited 0. next-action exiting 0 only means the CLI
 * printed instructions — it says nothing about whether the instruction was
 * carried out. `instruction_fetched` therefore exists as a distinct,
 * NON-terminal state, and only `action_confirmed` may be acknowledged.
 */
export type EventLifecycleState =
  | "discovered"
  | "classified"
  | "instruction_fetching"
  | "instruction_fetched"
  | "model_pending"
  | "action_proposed"
  | "action_authorized"
  | "action_rejected"
  | "action_broadcast"
  | "action_pending"
  | "action_confirmed"
  | "response_pending"
  | "response_published"
  | "acknowledged"
  | "retryable_failure"
  | "terminal_failure";

/**
 * Only a fully-finished event may stop being replayed.
 *
 * Note `action_confirmed` is deliberately NOT here. The on-chain action having
 * landed is not the end of the turn — the buyer still has to be told, honestly,
 * what happened. Acknowledging at action_confirmed would drop the XMTP status
 * on the floor whenever publication failed.
 */
const ACKNOWLEDGEABLE: ReadonlySet<EventLifecycleState> = new Set([
  "acknowledged",
  "terminal_failure",
]);

export function mayAcknowledge(state: EventLifecycleState): boolean {
  return ACKNOWLEDGEABLE.has(state);
}

/**
 * States in which the required on-chain action has definitively already
 * happened. Re-running the action from any of these would double-submit, so the
 * executor resumes at the publication step instead.
 *
 * This is what makes "a lost XMTP response must not repeat the action" true.
 */
const ACTION_ALREADY_DONE: ReadonlySet<EventLifecycleState> = new Set([
  "action_confirmed",
  "response_pending",
  "response_published",
  "acknowledged",
]);

export function actionAlreadyCompleted(state: EventLifecycleState): boolean {
  return ACTION_ALREADY_DONE.has(state);
}

/**
 * The action was signed and sent but its outcome is unknown (process died,
 * transport dropped). Re-running could double-submit an on-chain action, so
 * recovery must RECONCILE against authoritative state, never blind-retry.
 */
export function requiresReconciliation(state: EventLifecycleState): boolean {
  return state === "action_broadcast" || state === "action_pending";
}

export interface RetryDecision {
  retry: boolean;
  delayMs: number;
  reason: string;
}

/** Exported so tests assert against the real bound rather than a duplicated literal. */
export const MAX_ATTEMPTS = 15;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

/**
 * Bounded retry for model-provider failures.
 *
 * Sized against a real observation: OpenClaw's embedded runner retried a failed
 * Gemini call 3 extra times with no backoff, turning one turn into four
 * provider requests in under 4 seconds. Under a 429 that amplifies the exact
 * condition being rate-limited, so this route owns its own policy and honours
 * server-supplied retry-after rather than inheriting that behaviour.
 *
 * MAX_ATTEMPTS was raised from 5 to 15 after a SECOND real observation: this
 * `decideRetry`'s own `delayMs` is informational only — nothing in the executor
 * or the seller runtime sleeps on it (verified by inspection: no caller reads
 * the field). The actual retry cadence is entirely paced by the outer
 * `runSystemEventCycle` poll loop (SYSTEM_EVENT_POLL_MS, 60s in production), so
 * the real resilience window was `MAX_ATTEMPTS × ~60-90s` — about 4-5 minutes.
 * Live in production on 2026-08-03 (job 0x22a216415e2b1176d2111b136584e42f…,
 * a genuine paid A2A test, Fly logs on repodiet-agent-9636), a real Gemini 503
 * outage lasted ~4m10s (17:51:38Z first failure to 17:55:48Z
 * `max_attempts_exhausted`) and the event was marked `terminal_failure` —
 * exhausting the retry budget by roughly the width of the outage itself, not
 * because the failure was permanent. A well-formed, correctly-authorized event
 * was lost to a transient upstream blip the retry budget was too tight to
 * survive. 15 attempts at the same ~60-90s external cadence gives roughly
 * 15-25 minutes of resilience — enough margin for a realistic provider outage —
 * while still bounded and never infinite; genuinely permanent failures (401/
 * 403/404/400) are already terminal on the first attempt regardless of this
 * constant, so this only widens the window for transient ones.
 */
export function decideRetry(input: {
  status?: number;
  attempts: number;
  retryAfterSeconds?: number;
}): RetryDecision {
  const { status, attempts } = input;

  if (attempts >= MAX_ATTEMPTS) {
    return { retry: false, delayMs: 0, reason: "max_attempts_exhausted" };
  }

  // Quota exhaustion and auth/model errors are not transient — retrying burns
  // quota and delays an honest failure to the buyer.
  if (status === 401 || status === 403 || status === 404 || status === 400) {
    return { retry: false, delayMs: 0, reason: `terminal_provider_status:${status}` };
  }

  if (status === 429 || (typeof status === "number" && status >= 500)) {
    // Server-supplied retry-after always wins over local backoff.
    if (typeof input.retryAfterSeconds === "number" && input.retryAfterSeconds >= 0) {
      return {
        retry: true,
        delayMs: Math.min(input.retryAfterSeconds * 1_000, MAX_BACKOFF_MS),
        reason: "retry_after_honoured",
      };
    }
    return { retry: true, delayMs: backoffFor(attempts), reason: `backoff_status:${status}` };
  }

  // No HTTP status = an internal/unknown failure (next-action non-zero, task
  // detail unreadable, a turn that proposed no action at all). These MUST stay
  // retryable until the attempt bound: treating "unknown" as terminal would
  // acknowledge an event whose work never happened, which is the precise
  // false-acknowledgement defect this route exists to prevent. It is bounded
  // by MAX_ATTEMPTS above, so it cannot loop forever either.
  if (status === undefined) {
    return { retry: true, delayMs: backoffFor(attempts), reason: "internal_failure_retryable" };
  }

  return { retry: false, delayMs: 0, reason: "non_retryable" };
}

function backoffFor(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS);
}
