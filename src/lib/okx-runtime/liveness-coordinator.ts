/**
 * === The seam between "is the agent provably online" and "heavy work" ===
 *
 * Production evidence, 2026-08-07: the agent was proven healthy (22
 * consecutive `heartbeat_accepted`) BEFORE a heavy verification pipeline
 * started. Load rose to 7–8 on the 1-vCPU Fly machine DURING that pipeline,
 * `onchainos agent gate-check` could no longer complete inside its 300s
 * ceiling, and the heartbeat was withheld for the rest of the run. `nice 19`
 * was already applied and was not enough — nice arbitrates CPU scheduling
 * only, and the contention here also involves memory and process-creation
 * overhead that nice does not touch.
 *
 * "Refuse new heavy work while liveness is already unproven" is necessary but
 * INSUFFICIENT: it does nothing for a job that was admitted while healthy and
 * degrades liveness only after it starts running. The actual fix has two
 * halves — admission (this module's `isLivenessProvenFresh`, checked once
 * before a heavy job starts, see heavy-job-limiter.ts) and in-flight yielding
 * (this module's `requestLivenessRefresh`, invoked repeatedly WHILE a heavy
 * job runs, see bounded-process-group.ts).
 *
 * === Why this is a registrable seam rather than a direct import ===
 *
 * The actual gate-check machinery (`GateProofState`, `refreshOfficialGateCheck`,
 * the `onchainos agent gate-check` shell-out) lives in
 * scripts/repodiet-seller-runtime.ts — a script, not a library module, and the
 * only process that has Fly's ASP liveness concept at all. Heavy work is also
 * reachable from contexts that have NO such concept: the manual HTTP cleanup
 * route and the A2A orchestrator both run on Vercel, where "OKX gate-check" is
 * meaningless. A direct import would either create a script->lib->script cycle
 * or force liveness semantics onto callers that were never subject to them.
 *
 * The seller runtime registers its real implementation once at startup.
 * Everywhere else — tests, Vercel routes, any environment that never
 * registers — stays PERMISSIVE by construction, which is exactly the existing
 * behaviour for those callers today. This module changes nothing for them.
 */
export interface LivenessCoordinatorImpl {
  /**
   * Milliseconds until the current liveness proof is considered stale.
   * <= 0 means "not currently proven". Must not throw; a throwing
   * implementation is treated as "not proven" (fail closed).
   */
  freshnessRemainingMs(): number;
  /**
   * Triggers an out-of-cadence gate-check and resolves once it settles.
   * Must not throw; a throwing implementation is treated as a failed refresh.
   */
  requestRefresh(): Promise<boolean>;
}

let impl: LivenessCoordinatorImpl | undefined;

/** Called once by the seller runtime at startup. */
export function registerLivenessCoordinator(coordinator: LivenessCoordinatorImpl): void {
  impl = coordinator;
}

/** Test seam — production never calls this. */
export function unregisterLivenessCoordinatorForTests(): void {
  impl = undefined;
}

export function livenessFreshnessRemainingMs(): number {
  if (!impl) return Number.POSITIVE_INFINITY;
  try {
    return impl.freshnessRemainingMs();
  } catch {
    // A broken getter must read as "not proven", never as "assume fine".
    return 0;
  }
}

/**
 * `safetyMarginMs` lets a caller ask "is there still at least this much
 * runway before the proof goes stale", not merely "is it stale right now" —
 * the yield ticker uses a margin so it triggers a refresh with time to spare;
 * admission uses zero margin, since a job either can start now or cannot.
 */
export function isLivenessProvenFresh(safetyMarginMs = 0): boolean {
  return livenessFreshnessRemainingMs() > safetyMarginMs;
}

export async function requestLivenessRefresh(): Promise<boolean> {
  if (!impl) return true;
  try {
    return await impl.requestRefresh();
  } catch {
    return false;
  }
}
