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

export interface ReconcilerDeps extends ExecuteDeps {
  /** Unfinished events from the durable ledger, oldest first. */
  pending: () => Array<{ eventId: string; envelope: InboundEnvelope }>;
  log: (event: string, fields: Record<string, unknown>) => void;
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
  const pending = deps.pending();
  if (pending.length === 0) {
    deps.log("system_event_recovery_clean", { pending: 0 });
    return [];
  }

  deps.log("system_event_recovery_start", { pending: pending.length });
  const results: ExecuteResult[] = [];

  for (const { eventId, envelope } of pending) {
    try {
      const result = await executeSystemEvent(eventId, envelope, deps);
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
  const classification = classifyInbound(envelope);
  if (classification.kind !== "okx_system_event") {
    deps.log("system_event_declined", {
      eventId,
      kind: classification.kind,
      reason: "reason" in classification ? classification.reason : undefined,
    });
    return undefined;
  }

  const result = await executeSystemEvent(eventId, envelope, deps);
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
