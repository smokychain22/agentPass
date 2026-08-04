/**
 * Gate-check outcome classification and proof lifetime.
 *
 * === Incident #15: a slow diagnostic and a genuinely failed one were treated
 * identically, which made the runtime both less available AND less honest ===
 *
 * Observed live on repodiet-agent-9636: three consecutive `onchainos agent
 * gate-check` runs hit the 150s bound. At a 900s refresh cadence that is
 * exactly 2,700s — precisely GATE_CHECK_FRESHNESS_MS — so the cached proof
 * expired and the runtime withheld its marketplace heartbeat. The agent read
 * as offline to OKX for ~10 minutes despite `daemonOk` and `xmtpOk` both
 * being continuously true. It self-recovered when a later check finished
 * inside the bound.
 *
 * The old code funnelled every non-pass into one `catch` and returned
 * `false`. That conflates two states that are not the same thing at all:
 *
 *   - TIMEOUT / crash / unparseable output — INCONCLUSIVE. We learned
 *     nothing. `okx-a2a doctor` (which gate-check shells out to) makes live
 *     OKX-backend, XMTP and npm-registry calls, so its latency is externally
 *     variable and routinely swings past any bound we can afford. An
 *     inconclusive result is not evidence of a problem.
 *
 *   - A parsed result that says NOT ready — CONFIRMED FAILURE. The command
 *     ran to completion and told us the identity, wallet or communication
 *     channel is bad. That IS evidence of a problem.
 *
 * Treating them alike was wrong in both directions:
 *
 *   1. Under-available: an inconclusive timeout burned a whole 900s refresh
 *      slot, so three slow checks in a row silently exhausted the freshness
 *      window even though nothing was actually wrong.
 *   2. Under-honest — the more serious one: a CONFIRMED failure left the
 *      previous proof standing until it aged out, so for up to 45 minutes
 *      the runtime kept publishing "online" while holding a fresh, parsed,
 *      authoritative statement that its own gate was broken.
 *
 * The fix separates them:
 *
 *   - `inconclusive` PRESERVES the existing proof (it has not been
 *     contradicted) and schedules an earlier retry on bounded exponential
 *     backoff, so a transient slow window gets several extra attempts inside
 *     the freshness budget instead of only three.
 *   - `failed` INVALIDATES the proof immediately. The heartbeat is withheld
 *     on the very next tick, not 45 minutes later.
 *
 * This is strictly stronger than the fail-closed rule it replaces: publishing
 * still requires a real gate-check that genuinely passed and is still fresh.
 * What changes is that a contradicted proof now dies at once, and an
 * uncontradicted one is retried promptly rather than abandoned.
 */

export type GateCheckOutcome =
  | { kind: "passed"; durationMs: number }
  | { kind: "failed"; durationMs: number; reason: string }
  | { kind: "inconclusive"; durationMs: number; reason: string };

export interface GateCheckLimits {
  /** Hard bound on a single gate-check invocation. */
  timeoutMs: number;
  /** Normal cadence between full refreshes when things are healthy. */
  refreshMs: number;
  /** How long a passing proof stays valid. Must exceed `refreshMs`. */
  freshnessMs: number;
  /** First retry delay after an inconclusive result. */
  backoffBaseMs: number;
  /** Ceiling for backoff; never longer than a normal refresh. */
  backoffMaxMs: number;
}

export const DEFAULT_GATE_CHECK_LIMITS: GateCheckLimits = {
  timeoutMs: 150_000,
  refreshMs: 900_000,
  freshnessMs: 2_700_000,
  // 60s → 120s → 240s → 480s → capped. Inside one 2,700s freshness window
  // that is ~7 attempts instead of the old 3, without hammering a command
  // whose own cost is the thing making it slow.
  backoffBaseMs: 60_000,
  backoffMaxMs: 480_000,
};

/**
 * Classifies a completed (or abandoned) gate-check invocation.
 *
 * `error` is whatever the process runner threw — a timeout kill, a non-zero
 * exit, or nothing at all when the command returned cleanly.
 */
export function classifyGateCheckOutcome(input: {
  stdout?: string;
  error?: { killed?: boolean; signal?: string | null; code?: string | number; message?: string };
  durationMs: number;
  expectedAgentId: string;
  timeoutMs: number;
}): GateCheckOutcome {
  const { error, durationMs, expectedAgentId } = input;

  if (error) {
    // A kill at (or past) the bound is a timeout, however the runner spells
    // it: `killed`, SIGTERM/SIGKILL, or ETIMEDOUT. All inconclusive.
    const timedOut =
      error.killed === true ||
      error.code === "ETIMEDOUT" ||
      error.signal === "SIGTERM" ||
      error.signal === "SIGKILL" ||
      durationMs >= input.timeoutMs;
    return {
      kind: "inconclusive",
      durationMs,
      reason: timedOut ? "timeout" : `invocation_error:${error.message ?? error.code ?? "unknown"}`,
    };
  }

  // Command exited cleanly — now the OUTPUT decides. Output we cannot parse is
  // inconclusive, not a failure: an unreadable answer is not a "no".
  let parsed: unknown;
  try {
    const line = (input.stdout ?? "").trim().split("\n").pop() ?? "";
    parsed = JSON.parse(line);
  } catch {
    return { kind: "inconclusive", durationMs, reason: "unparseable_output" };
  }

  const data = (parsed as { data?: Record<string, unknown> })?.data;
  if (!data || typeof data !== "object") {
    return { kind: "inconclusive", durationMs, reason: "missing_data_envelope" };
  }

  const identity = data.identity as { agentId?: string } | undefined;
  const communication = data.communication as { ok?: boolean } | undefined;
  const wallet = data.wallet as { ok?: boolean } | undefined;

  // A parsed answer naming the WRONG agent is never "just inconclusive" —
  // it is a confirmed identity failure and must invalidate the proof.
  if (identity?.agentId !== undefined && identity.agentId !== expectedAgentId) {
    return {
      kind: "failed",
      durationMs,
      reason: `identity_mismatch:${identity.agentId}`,
    };
  }

  const passed =
    data.ready === true &&
    identity?.agentId === expectedAgentId &&
    communication?.ok === true &&
    wallet?.ok === true;

  if (passed) return { kind: "passed", durationMs };

  const failing: string[] = [];
  if (data.ready !== true) failing.push("ready");
  if (identity?.agentId !== expectedAgentId) failing.push("identity");
  if (communication?.ok !== true) failing.push("communication");
  if (wallet?.ok !== true) failing.push("wallet");
  return { kind: "failed", durationMs, reason: `gate_not_ready:${failing.join(",")}` };
}

/** How the runtime is currently representing itself, for honest logging. */
export type GateHealth = "proven" | "degraded_unconfirmed" | "unproven";

/**
 * Holds the last passing proof and decides, from outcomes alone, whether the
 * runtime may claim to be online.
 *
 * Deliberately pure and clock-injectable so every branch — slow check, timed
 * out refresh, valid cached proof, expired cached proof, confirmed failure,
 * recovery after timeout — is directly testable without real timers.
 */
export class GateProofState {
  private passedAtMs = 0;
  private consecutiveInconclusive = 0;
  /** Set when a parsed result contradicted the proof. Cleared only by a pass. */
  private confirmedFailureReason: string | undefined;

  constructor(private readonly limits: GateCheckLimits = DEFAULT_GATE_CHECK_LIMITS) {}

  /** Restores a persisted proof. Rejects absent, future-dated or stale values. */
  restore(passedAtMs: number, nowMs: number = Date.now()): boolean {
    if (!Number.isFinite(passedAtMs) || passedAtMs <= 0) return false;
    if (passedAtMs > nowMs) return false; // clock skew / tampering — never trust
    if (nowMs - passedAtMs >= this.limits.freshnessMs) return false;
    this.passedAtMs = passedAtMs;
    return true;
  }

  get lastPassedAtMs(): number {
    return this.passedAtMs;
  }

  record(outcome: GateCheckOutcome, nowMs: number = Date.now()): void {
    if (outcome.kind === "passed") {
      this.passedAtMs = nowMs;
      this.consecutiveInconclusive = 0;
      this.confirmedFailureReason = undefined;
      return;
    }
    if (outcome.kind === "failed") {
      // Contradicted. The proof dies now — not when it would have aged out.
      this.passedAtMs = 0;
      this.consecutiveInconclusive = 0;
      this.confirmedFailureReason = outcome.reason;
      return;
    }
    // Inconclusive: the proof stands, but we owe a prompt retry.
    this.consecutiveInconclusive += 1;
  }

  isFresh(nowMs: number = Date.now()): boolean {
    return this.passedAtMs > 0 && nowMs - this.passedAtMs < this.limits.freshnessMs;
  }

  /** The only question the heartbeat asks. */
  mayClaimOnline(nowMs: number = Date.now()): boolean {
    return this.confirmedFailureReason === undefined && this.isFresh(nowMs);
  }

  health(nowMs: number = Date.now()): GateHealth {
    if (this.confirmedFailureReason !== undefined) return "unproven";
    if (this.isFresh(nowMs)) {
      return this.consecutiveInconclusive > 0 ? "degraded_unconfirmed" : "proven";
    }
    return "unproven";
  }

  /** Human-readable reason the runtime is not claiming online, if it is not. */
  reason(nowMs: number = Date.now()): string | undefined {
    if (this.confirmedFailureReason !== undefined) return this.confirmedFailureReason;
    if (!this.isFresh(nowMs)) {
      return this.passedAtMs === 0 ? "no_proof_yet" : "proof_expired";
    }
    return undefined;
  }

  /**
   * When to run the next refresh. Inconclusive results back off from a short
   * base so a transient slow window is retried several times well inside the
   * freshness budget; anything else returns to the normal slow cadence.
   */
  nextRefreshDelayMs(): number {
    if (this.consecutiveInconclusive === 0) return this.limits.refreshMs;
    const backoff =
      this.limits.backoffBaseMs * 2 ** Math.min(this.consecutiveInconclusive - 1, 10);
    return Math.min(backoff, this.limits.backoffMaxMs, this.limits.refreshMs);
  }
}
