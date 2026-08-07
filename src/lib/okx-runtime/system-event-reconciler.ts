/**
 * Production entry point for the system-event route.
 *
 * This is what stops the executor being dead code. The audited defect had two
 * layers: the worker acknowledged without executing, AND it had no production
 * caller at all — `acknowledgeProviderEvent` was reachable only from tests, so
 * `onchainos agent next-action` never ran in production even once.
 *
 * Two triggers, both required:
 *
 *   1. recoverPendingEvents() — on runtime startup. Any event the ledger shows
 *      as unfinished is resumed. This is what makes a crash mid-turn (or a Fly
 *      redeploy landing between broadcast and acknowledgement) recoverable
 *      instead of silently lost.
 *   2. handleSystemEvent() — for each newly observed official system event.
 *
 * Both funnel through the same executeSystemEvent(), so the authorization
 * boundary, ledger and idempotency rules cannot be bypassed by either path.
 */
import {
  executeSystemEvent,
  type ExecuteDeps,
  type ExecuteResult,
} from "./provider-event-executor";
import { classifyInbound, type InboundEnvelope } from "./system-event-route";
import { systemEventsSuspended } from "./system-event-suspension";

export interface ReconcilerDeps extends ExecuteDeps {
  /** Unfinished events from the durable ledger, oldest first. */
  pending: () => Array<{ eventId: string; envelope: InboundEnvelope }>;
  log: (event: string, fields: Record<string, unknown>) => void;
}

/**
 * Hard wall-clock ceiling on ONE event's execution.
 *
 * === Incident #19 ===
 * A `npm install` inside the first pending event's verification pipeline ran
 * for 20+ minutes on the production Machine. Because recovery walks events
 * sequentially, that single event occupied the loop indefinitely — and the
 * poll loop's own `systemEventCycleInFlight` guard means a wedged cycle also
 * stops every LATER cycle, so no NEW event (a reviewer's `job_asp_selected`,
 * say) would ever be drained from the spool either. One stuck job silently
 * became a total processing outage.
 *
 * Deliberately larger than the heavy-job limiter's own bound, so this is a
 * backstop for hangs OUTSIDE that limiter (GitHub calls, CLI subprocesses, an
 * install that escaped its own timeout) rather than a competing deadline.
 *
 * Abandoning the await is safe by construction: `executeSystemEvent` persists
 * evidence before it acts and releases its ledger lock in a `finally`, so a
 * timed-out event stays unacknowledged, unaltered and replayable — exactly the
 * state a crash would leave it in.
 */
export const EVENT_EXECUTION_TIMEOUT_MS = Number(
  process.env.REPODIET_EVENT_EXECUTION_TIMEOUT_MS || 1_200_000
);

class EventDeadlineExceeded extends Error {
  constructor(readonly eventId: string, readonly timeoutMs: number) {
    super(`event ${eventId} exceeded its ${timeoutMs}ms execution bound`);
    this.name = "EventDeadlineExceeded";
  }
}

/** Runs one event under the deadline above. Never lets a hang own the loop. */
async function executeWithDeadline(
  eventId: string,
  envelope: InboundEnvelope,
  deps: ReconcilerDeps
): Promise<ExecuteResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      executeSystemEvent(eventId, envelope, deps),
      new Promise<never>((_resolve, reject) => {
        // Not unref'd: a bound that the event loop may skip is not a bound.
        // Always cleared below, so it cannot outlive the event it guards.
        timer = setTimeout(
          () => reject(new EventDeadlineExceeded(eventId, EVENT_EXECUTION_TIMEOUT_MS)),
          EVENT_EXECUTION_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Resumes every unfinished event after startup.
 *
 * Sequential by design: concurrent resumption of two events that touch the same
 * job could interleave on-chain actions. The per-event ledger lock would still
 * hold, but serialising here keeps the recovery path obviously correct rather
 * than merely defensibly correct.
 */
export async function recoverPendingEvents(deps: ReconcilerDeps): Promise<ExecuteResult[]> {
  /**
   * Checked BEFORE `deps.pending()` is even read: suspension must not touch
   * the ledger at all, so a suspended runtime cannot alter retry metadata as a
   * side effect of merely looking.
   */
  if (systemEventsSuspended()) {
    deps.log("system_events_suspended", {
      phase: "startup_recovery",
      note: "REPODIET_SUSPEND_SYSTEM_EVENTS is set; pending events left untouched and unacknowledged",
    });
    return [];
  }

  const pending = deps.pending();
  if (pending.length === 0) {
    deps.log("system_event_recovery_clean", { pending: 0 });
    return [];
  }

  deps.log("system_event_recovery_start", { pending: pending.length });
  const results: ExecuteResult[] = [];

  for (const { eventId, envelope } of pending) {
    try {
      const result = await executeWithDeadline(eventId, envelope, deps);
      results.push(result);
      deps.log("system_event_recovered", {
        eventId,
        state: result.state,
        acknowledged: result.acknowledged,
        reason: result.reason,
      });
    } catch (err) {
      // A single poisoned record must not abort recovery of the rest, and must
      // never be treated as handled.
      deps.log("system_event_recovery_error", {
        eventId,
        message: err instanceof Error ? err.message : "unknown_error",
      });
    }
  }

  deps.log("system_event_recovery_complete", { processed: results.length });
  return results;
}

/**
 * Handles one newly observed inbound envelope.
 *
 * Classification runs here too, before any work, so a buyer message is rejected
 * at the boundary and never reaches next-action, the model, or the ledger.
 */
export async function handleSystemEvent(
  eventId: string,
  envelope: InboundEnvelope,
  deps: ReconcilerDeps
): Promise<ExecuteResult | undefined> {
  /**
   * Second, independent guard. `runSystemEventCycle` already refuses to run
   * while suspended, but this is the single choke point every execution path
   * passes through, so checking here means no future caller can reach
   * `executeSystemEvent` by adding a path that forgets the outer check.
   *
   * Returns undefined — the same "not handled" signal used for a declined
   * classification — so the caller neither acknowledges nor retires anything.
   */
  if (systemEventsSuspended()) {
    deps.log("system_events_suspended", {
      phase: "handle_event",
      eventId,
      note: "REPODIET_SUSPEND_SYSTEM_EVENTS is set; event left pending and unacknowledged",
    });
    return undefined;
  }

  const classification = classifyInbound(envelope);
  if (classification.kind !== "okx_system_event") {
    deps.log("system_event_declined", {
      eventId,
      kind: classification.kind,
      reason: "reason" in classification ? classification.reason : undefined,
    });
    return undefined;
  }

  const result = await executeWithDeadline(eventId, envelope, deps);
  deps.log("system_event_processed", {
    eventId,
    jobId: classification.jobId,
    event: classification.event,
    state: result.state,
    acknowledged: result.acknowledged,
    reason: result.reason,
  });
  return result;
}
