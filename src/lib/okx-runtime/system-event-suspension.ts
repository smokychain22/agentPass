/**
 * Operator kill switch for the autonomous system-event path.
 *
 * ## Why this exists
 *
 * `recoverPendingEvents` runs at STARTUP, before and independent of the
 * polling interval. Slowing the poll (`REPODIET_SYSTEM_EVENT_POLL_MS`) therefore
 * does not stop a restart from immediately replaying every unfinished event —
 * observed live on 2026-08-06, where a restart logged
 * `system_event_recovery_start {"pending":11}` and resumed the funded job's
 * full analysis pipeline, saturating a shared-cpu-1x/2GB machine until the
 * 150s gate-check timed out and heartbeats were withheld.
 *
 * Worse, the only way to change that interval is a secret update, which itself
 * restarts the machine and triggers the very recovery pass it was meant to
 * prevent. A flag that is read at startup, and checked again before any event
 * is claimed, is the only thing that actually breaks that loop.
 *
 * ## What suspension does NOT do
 *
 * Suspension is a PAUSE, never a decision about an event. Nothing here
 * acknowledges, rejects, retires, delivers or settles anything, and nothing
 * mutates the spool, the ledger or retry metadata. A suspended runtime leaves
 * every pending event exactly as it found it, so lifting the flag resumes the
 * identical work.
 *
 * The supervisor, seller runtime, A2A daemon, XMTP client and heartbeat
 * publication all keep running normally — the agent stays provably online and
 * simply stops executing job work.
 *
 * ## Fail-safe direction
 *
 * Unset means NOT suspended, so this can never silently disable production by
 * being absent. Only explicit truthy values engage it.
 */

/** Values that engage suspension. Anything else — including unset — does not. */
const TRUTHY = new Set(["1", "true", "yes", "on"]);

export const SUSPEND_SYSTEM_EVENTS_ENV = "REPODIET_SUSPEND_SYSTEM_EVENTS";

/**
 * Whether the autonomous system-event path is suspended.
 *
 * Read from the supplied environment (defaulting to `process.env`) on every
 * call rather than cached, so a test can flip it without module reloading and
 * so the check cannot go stale within a long-lived process.
 */
export function systemEventsSuspended(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[SUSPEND_SYSTEM_EVENTS_ENV];
  if (typeof raw !== "string") return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}
