/**
 * Provider application for open A2A jobs — the missing half of the ASP
 * lifecycle.
 *
 * === The defect this closes ===
 *
 * Read live from Agent 9636's own provider view (`onchainos agent
 * active-tasks`, run under the seller account), seven jobs sat at
 * `status: created` / `statusCode: 0` with 9636 already named as the ASP and
 * ZERO applications against any of them. The runtime had no code path that
 * could ever call `onchainos agent apply` — the command was not merely
 * unused, it was absent from `ALLOWED_COMMANDS`, so even a model turn that
 * proposed it would have been refused at the authorization boundary.
 *
 * A job designated to 9636 sits at `created` until the provider applies. The
 * buyer cannot confirm, escrow cannot fund, and the task eventually times out
 * — which is exactly the failure class OKX reported ("we were unable to
 * receive a response from your Agent, causing the task to time out").
 *
 * === The authoritative mechanism ===
 *
 * Discovered from the installed CLI's own help, not guessed:
 *
 *   onchainos agent apply <JOB_ID>
 *     --token-amount <AMOUNT>   Negotiated token amount. Required; must be > 0
 *                               (empty / 0 = apply for free, IRREVERSIBLE —
 *                               the CLI itself rejects it)
 *     --token-symbol <SYMBOL>   Actual task currency; read from negotiation
 *                               context, do not assume USDT
 *     --agent-id <AGENT_ID>
 *
 *   "Provider applies for a task (apply API → sign → broadcast)"
 *
 * That trailing "→ sign → broadcast" is the whole reason this module is
 * shaped the way it is: apply is an on-chain, irreversible, gas-spending
 * action. It is not a status flag. Everything below exists to make sure it
 * happens exactly once per job, on exactly the right jobs, at exactly the
 * amount the task authoritatively carries.
 */
import { REPODIET_OKX_SERVICES } from "./service-selection";
import { SELLER_AGENT_ID, type ProposedAction } from "./system-event-route";

/** X Layer. The only network this provider transacts on. */
export const X_LAYER_CHAIN_INDEX = 196;

/** `created` — the only status from which a provider may apply. */
export const STATUS_CREATED = 0;

/**
 * A candidate open job, assembled from authoritative OKX reads only
 * (`agent active-tasks` + `agent status` + the next-action task-fields
 * block). Nothing here is ever taken from a model's recollection or from an
 * inbound chat message.
 */
export interface ApplyCandidate {
  jobId: string;
  /** The agent OKX has designated as provider for this job. */
  aspAgentId?: string;
  buyerAgentId?: string;
  /** Our role on this job as OKX reports it. */
  myRole?: string;
  statusCode: number;
  tokenAmount: string;
  tokenSymbol: string;
  /**
   * Frequently ABSENT. Neither `agent active-tasks` nor `agent status` nor
   * `agent common context` exposes a serviceId — verified live against real
   * jobs. It is therefore matched when present and inferred when not; see
   * `assessApplyEligibility`.
   */
  serviceId?: string;
  operation?: string;
  chainIndex?: number;
  /**
   * `paymentType=1` — escrow. Required as corroboration when serviceId is
   * absent, because the agent's only escrow-settled service is the A2A one.
   */
  escrowPayment?: boolean;
  /** Resolved from serviceParams or the task description. */
  repositoryUrl?: string;
  title?: string;
}

export type ApplyEligibility = { eligible: true } | { eligible: false; reason: string };

/**
 * A prior-application record, read from the durable ledger. `uncertain` is the
 * important one: a broadcast whose outcome we never confirmed. It must block a
 * repeat attempt just as firmly as a confirmed one — see `assessApplyEligibility`.
 */
export interface PriorApplication {
  jobId: string;
  state: "applied" | "uncertain" | "failed";
  transactionRef?: string;
}

const AMOUNT_PATTERN = /^\d+(\.\d+)?$/;

/**
 * A repository URL must be a real GitHub repo. A job whose scope is missing or
 * unparseable is not something this provider can price or perform, so it is
 * never applied for — applying would commit to work of unknown shape.
 */
function hasUsableRepositoryScope(url: string | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  return /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/?$/i.test(url.trim());
}

/**
 * Discovery questions and generic chatter arrive on the same channels as real
 * task events. They carry no job scope and must never trigger an on-chain,
 * gas-spending application.
 */
/**
 * Deliberately narrow: it matches conversational OPENERS only, and only at the
 * start of the title. "RepoDiet Availability Check" is NOT in here despite
 * sounding like a probe — live data shows it as a genuine 0.2 USDT task that
 * reached `accepted`. Misclassifying a real titled job as chatter would refuse
 * paid work, so the scope gate (`repository_scope_missing`) is what actually
 * stops probes; this only catches unmistakable greetings.
 */
export function isDiscoveryOnlyTitle(title: string | undefined): boolean {
  if (!title) return false;
  return /^\s*(hi|hello|hey|test|ping|what|which|who|how|is\s+repodiet|are\s+you)\b/i.test(title);
}

/**
 * The complete eligibility gate. Every condition must be authoritatively true;
 * anything unknown is a refusal, never an assumption.
 *
 * Ordered cheapest-and-most-decisive first so the logged reason names the
 * actual disqualifier rather than an incidental one.
 */
export function assessApplyEligibility(
  candidate: ApplyCandidate,
  prior?: PriorApplication
): ApplyEligibility {
  const a2a = REPODIET_OKX_SERVICES.a2a;

  // --- identity / role -----------------------------------------------------
  if (!/^0x[0-9a-f]{64}$/i.test(candidate.jobId)) {
    return { eligible: false, reason: "job_id_malformed" };
  }
  if (candidate.aspAgentId !== SELLER_AGENT_ID) {
    // Not designated to us. This is what keeps the reconciler off every job
    // that merely happens to be open — eligibility is derived from the
    // binding OKX published, never from a list of agent ids.
    return { eligible: false, reason: "not_designated_provider" };
  }
  if (candidate.myRole !== undefined && candidate.myRole !== "asp") {
    return { eligible: false, reason: `not_provider_role:${candidate.myRole}` };
  }
  if (!candidate.buyerAgentId) {
    return { eligible: false, reason: "buyer_unknown" };
  }
  if (candidate.buyerAgentId === SELLER_AGENT_ID) {
    // Self-dealing: never apply to our own task.
    return { eligible: false, reason: "buyer_is_self" };
  }

  // --- service / operation -------------------------------------------------
  //
  // A serviceId, when OKX gives us one, must be the A2A service exactly.
  //
  // When it does NOT — and verified live, none of `active-tasks`, `agent
  // status` or `agent common context` carries one — requiring it would refuse
  // every real job and make this whole path a no-op. So it is inferred, but
  // only from corroborating authoritative facts rather than assumed: Agent
  // 9636 publishes exactly two services, and only one of them is an
  // escrow-settled A2A task (37348). The other (37347) is an x402
  // pay-per-call HTTP endpoint that never produces an on-chain job at all.
  // An escrow-payment job designated to this provider therefore cannot be
  // anything but 37348.
  if (candidate.serviceId !== undefined) {
    if (candidate.serviceId !== a2a.serviceId) {
      return { eligible: false, reason: `service_not_a2a:${candidate.serviceId}` };
    }
  } else if (candidate.escrowPayment !== true) {
    // No serviceId AND no escrow corroboration — refuse rather than guess.
    return { eligible: false, reason: "service_unverifiable" };
  }
  if (candidate.operation !== undefined && candidate.operation !== a2a.operation) {
    return { eligible: false, reason: `operation_not_cleanup:${candidate.operation}` };
  }

  // --- lifecycle state -----------------------------------------------------
  if (candidate.statusCode !== STATUS_CREATED) {
    // Includes every terminal state AND `accepted` (1) — a job past `created`
    // has already been applied for. Re-applying would be a duplicate
    // on-chain action against a job that has moved on.
    return { eligible: false, reason: `status_not_open:${candidate.statusCode}` };
  }

  // --- network -------------------------------------------------------------
  if (candidate.chainIndex !== undefined && candidate.chainIndex !== X_LAYER_CHAIN_INDEX) {
    return { eligible: false, reason: `network_not_x_layer:${candidate.chainIndex}` };
  }

  // --- price / token -------------------------------------------------------
  // The CLI rejects a zero/empty amount as an irreversible "apply for free".
  // Refusing here means that branch is never even reached.
  if (!AMOUNT_PATTERN.test(candidate.tokenAmount ?? "")) {
    return { eligible: false, reason: `token_amount_malformed:${candidate.tokenAmount}` };
  }
  if (Number(candidate.tokenAmount) <= 0) {
    return { eligible: false, reason: "token_amount_not_positive" };
  }
  if (!candidate.tokenSymbol) {
    return { eligible: false, reason: "token_symbol_missing" };
  }

  // --- scope ---------------------------------------------------------------
  if (isDiscoveryOnlyTitle(candidate.title)) {
    return { eligible: false, reason: "discovery_message_not_a_task" };
  }
  if (!hasUsableRepositoryScope(candidate.repositoryUrl)) {
    return { eligible: false, reason: "repository_scope_missing" };
  }

  // --- idempotency ---------------------------------------------------------
  // Last, so the reason reported for an ineligible job is about the job, not
  // about our own bookkeeping.
  if (prior) {
    if (prior.state === "applied") {
      return { eligible: false, reason: "already_applied" };
    }
    if (prior.state === "uncertain") {
      // A broadcast we never confirmed. Reconcile against authoritative state
      // first; NEVER blind-retry — that is how a double broadcast happens.
      return { eligible: false, reason: "prior_broadcast_unconfirmed" };
    }
  }

  return { eligible: true };
}

/**
 * Builds the exact official command. Argument array only — never an
 * interpolated shell string — and every value comes from the authoritative
 * candidate, so `authorizeAction` can re-verify each one independently.
 */
export function buildApplyAction(candidate: ApplyCandidate): ProposedAction {
  return {
    command: "agent apply",
    args: [
      candidate.jobId,
      "--token-amount",
      candidate.tokenAmount,
      "--token-symbol",
      candidate.tokenSymbol,
      "--agent-id",
      SELLER_AGENT_ID,
    ],
  };
}

/** Ledger key for an application. One per job, per intended action. */
export function applyLedgerKey(jobId: string): string {
  return `provider_apply:${jobId.toLowerCase()}`;
}

/**
 * How the reconciler is allowed to act.
 *
 * `dry_run` is the default deliberately. Applying is irreversible and spends
 * gas; enabling it live is an operator decision, made once, with the open-job
 * set known. A misconfigured or unset environment therefore observes and
 * reports without ever broadcasting.
 */
export type ApplyMode = "off" | "dry_run" | "live";

export function parseApplyMode(raw: string | undefined): ApplyMode {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "live") return "live";
  if (value === "off") return "off";
  return "dry_run";
}
