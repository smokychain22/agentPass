/**
 * The boundary between the durable ledger and the executor, and the intake for
 * newly observed official system events.
 *
 * Three jobs, all of them fail-closed:
 *
 *  1. validateOfficialEnvelope() — the ONLY way an envelope becomes eligible to
 *     execute. Applied on the way in (a newly observed event) AND on the way
 *     out (an envelope read back from the ledger after a restart). A stored
 *     record is not more trustworthy than a live message just because it is on
 *     our own disk: the volume outlives the process, is writable by anything
 *     else in the container, and a record written by an older build may predate
 *     this validation entirely. So it is re-proven every time.
 *
 *  2. LedgerActionStore — presents the crash-safe FileActionLedger as the
 *     narrow ActionLedger the executor consumes. It also does the one thing the
 *     executor cannot: mark a record `acknowledged` when, and only when, the
 *     lifecycle genuinely reached `acknowledged`. Without that, every finished
 *     event would still look pending and be replayed on the next boot.
 *
 *  3. The durable inbox — a spool directory on the mounted volume. A producer
 *     writes one JSON envelope per file; this drains it. The spool exists so an
 *     event that arrives while the runtime is down is not lost, and so an event
 *     is never consumed before the ledger has durably recorded it.
 *
 * Nothing here decides WHAT to do about an event. Classification, the
 * authorization boundary, the model turn and idempotency all stay in
 * system-event-route / provider-event-executor, reached through one executor.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { FileActionLedger, LedgerRecord } from "./action-ledger";
import type { ActionEvidence, ActionLedger } from "./provider-event-executor";
import {
  classifyInbound,
  SELLER_AGENT_ID,
  type InboundEnvelope,
} from "./system-event-route";

/**
 * Hard ceiling on a stored/accepted envelope.
 *
 * An official system envelope is routing metadata plus a task-detail block —
 * kilobytes at most. A megabyte-scale "envelope" is either corruption or an
 * attempt to push something through next-action's `--message`, and either way
 * it must not reach a CLI argument or a model prompt. Bounded here, once, so
 * neither the ledger file nor the argv can be grown without limit.
 */
export const MAX_ENVELOPE_BYTES = 32_768;

export type EnvelopeVerdict =
  | { ok: true; envelope: InboundEnvelope; event: string; jobId: string }
  | { ok: false; reason: string };

/**
 * Proves an envelope is a genuine official system event for THIS provider.
 *
 * `expectedJobId`, when supplied, is the job the ledger record claims. A stored
 * envelope naming a different job is untrusted by definition — it would let a
 * record for one job drive an action against another.
 */
export function validateOfficialEnvelope(
  raw: unknown,
  expectedJobId?: string
): EnvelopeVerdict {
  if (raw === undefined || raw === null) return { ok: false, reason: "envelope_missing" };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "envelope_not_an_object" };
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    // Cyclic or otherwise unserialisable — it cannot have come off the wire.
    return { ok: false, reason: "envelope_not_serialisable" };
  }
  if (!serialized) return { ok: false, reason: "envelope_not_serialisable" };
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > MAX_ENVELOPE_BYTES) {
    return { ok: false, reason: `envelope_oversized:${bytes}` };
  }

  const envelope = raw as InboundEnvelope;

  // An envelope with no explicit addressee cannot be proven to be ours.
  // classifyInbound tolerates an absent agentId because a live transport may
  // omit it; a PERSISTED envelope has no such excuse, and "unproven" must never
  // read as "ours" when the consequence is an on-chain action.
  if (envelope.agentId === undefined) {
    return { ok: false, reason: "envelope_agent_id_absent" };
  }
  if (String(envelope.agentId) !== SELLER_AGENT_ID) {
    return { ok: false, reason: "envelope_agent_id_not_seller" };
  }

  const classification = classifyInbound(envelope);
  if (classification.kind !== "okx_system_event") {
    // Both non-system classifications carry their own reason, which is more
    // diagnostic than the bare kind.
    return { ok: false, reason: `envelope_not_official:${classification.reason}` };
  }

  if (expectedJobId && classification.jobId.toLowerCase() !== expectedJobId.toLowerCase()) {
    return { ok: false, reason: "envelope_job_id_mismatch" };
  }

  return {
    ok: true,
    envelope,
    event: classification.event,
    jobId: classification.jobId,
  };
}

/**
 * Identity of the WORK an event represents, as opposed to the delivery.
 *
 * Keyed on (provider, event, jobId) so the same official event redelivered
 * under a new transport id is recognised as the same work and cannot be
 * executed twice.
 */
export function semanticKeyFor(event: string, jobId: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ agentId: SELLER_AGENT_ID, event, jobId: jobId.toLowerCase() }))
    .digest("hex");
}

/**
 * Stable id for one delivery. A transport-supplied id is used when present —
 * it is what distinguishes two genuinely separate deliveries — otherwise the
 * envelope content itself is hashed, so a redelivery with no id at least
 * collapses onto the same record instead of executing again.
 */
export function deriveEventId(envelope: InboundEnvelope, transportId?: string): string {
  if (transportId && transportId.trim()) return transportId.trim();
  return `evt-${createHash("sha256").update(JSON.stringify(envelope)).digest("hex").slice(0, 32)}`;
}

/** Drops undefined-valued keys so a patch never erases previously stored evidence. */
function defined<T extends object>(patch: T): T {
  for (const key of Object.keys(patch)) {
    if ((patch as Record<string, unknown>)[key] === undefined) {
      delete (patch as Record<string, unknown>)[key];
    }
  }
  return patch;
}

/**
 * Adapts the durable, process-safe FileActionLedger to the executor's narrow
 * ActionLedger contract.
 *
 * The `acknowledged` flag is set here rather than in the executor because it is
 * a property of the RECORD (may this stop being replayed?), not of one turn.
 * It is derived from the lifecycle state — never passed in — so there is no
 * argument a caller could supply that acknowledges unfinished work.
 */
export class LedgerActionStore implements ActionLedger {
  constructor(private readonly ledger: FileActionLedger) {}

  get(eventId: string): ActionEvidence | undefined {
    const record = this.ledger.get(eventId);
    if (!record) return undefined;
    return {
      state: record.state,
      instructionDigest: record.instructionDigest,
      modelInvocationId: record.modelInvocationId,
      action: record.authorizedAction,
      transactionRef: record.transactionRef,
      xmtpMessageId: record.xmtpOutboundId,
      error: record.lastError,
      attempts: record.attempts,
    };
  }

  put(eventId: string, evidence: ActionEvidence): void {
    this.ledger.put(
      eventId,
      defined({
        state: evidence.state,
        instructionDigest: evidence.instructionDigest,
        modelInvocationId: evidence.modelInvocationId,
        authorizedAction: evidence.action,
        argv: evidence.action ? [...evidence.action.args] : undefined,
        transactionRef: evidence.transactionRef,
        xmtpOutboundId: evidence.xmtpMessageId,
        lastError: evidence.error,
        terminalReason: evidence.state === "terminal_failure" ? evidence.error : undefined,
        attempts: evidence.attempts,
        // Derived, never supplied. Only a lifecycle that genuinely reached
        // `acknowledged` stops the event being replayed; `terminal_failure` is
        // already excluded from recovery by the ledger itself.
        acknowledged: evidence.state === "acknowledged" ? true : undefined,
      })
    );
  }

  tryLock(eventId: string): boolean {
    return this.ledger.tryLock(eventId);
  }

  unlock(eventId: string): void {
    this.ledger.unlock(eventId);
  }
}

export type IntakeLog = (event: string, fields: Record<string, unknown>) => void;

export type RegisterOutcome =
  | { accepted: true; eventId: string; envelope: InboundEnvelope; duplicate: boolean }
  | { accepted: false; reason: string };

/**
 * Records a newly observed envelope BEFORE any work is attempted.
 *
 * Ordering matters: the envelope is durable first, so a crash between observing
 * an event and executing it leaves a recoverable record rather than a lost one.
 * An event whose semantic identity was already completed under a different
 * delivery id is reported as a duplicate and never re-executed.
 */
export function registerObservedEvent(
  ledger: FileActionLedger,
  envelope: unknown,
  options: { transportId?: string; log?: IntakeLog } = {}
): RegisterOutcome {
  const verdict = validateOfficialEnvelope(envelope);
  if (!verdict.ok) {
    options.log?.("system_event_rejected_at_intake", { reason: verdict.reason });
    return { accepted: false, reason: verdict.reason };
  }

  const eventId = deriveEventId(verdict.envelope, options.transportId);
  const semanticKey = semanticKeyFor(verdict.event, verdict.jobId);

  const existing = ledger.get(eventId);
  if (existing) {
    // Already known. Never rewrite its state — that would rewind a lifecycle
    // that may already hold on-chain evidence.
    return { accepted: true, eventId, envelope: verdict.envelope, duplicate: true };
  }

  const sameWork = ledger.findBySemanticKey(semanticKey);
  if (sameWork && (sameWork.acknowledged || sameWork.state === "terminal_failure")) {
    options.log?.("system_event_duplicate_semantic_key", {
      eventId,
      priorEventId: sameWork.eventId,
      state: sameWork.state,
    });
    return { accepted: false, reason: "duplicate_semantic_key" };
  }

  ledger.put(eventId, {
    state: "discovered",
    semanticKey,
    jobId: verdict.jobId,
    envelope: verdict.envelope,
    attempts: 0,
    acknowledged: false,
  });

  return { accepted: true, eventId, envelope: verdict.envelope, duplicate: false };
}

/**
 * Rebuilds the resumable work set after a restart, from the stored envelopes.
 *
 * A record whose envelope no longer validates is skipped, loudly. It is
 * deliberately NOT failed or acknowledged: acknowledging it would suppress work
 * that may never have run, and marking it terminal would do the same. It stays
 * on disk, unexecuted and unacknowledged, for an operator to inspect.
 */
export function pendingSystemEvents(
  ledger: FileActionLedger,
  log?: IntakeLog
): Array<{ eventId: string; envelope: InboundEnvelope }> {
  const pending: Array<{ eventId: string; envelope: InboundEnvelope }> = [];

  for (const record of ledger.pendingForRecovery()) {
    const verdict = validateOfficialEnvelope(record.envelope, record.jobId);
    if (!verdict.ok) {
      log?.("system_event_envelope_untrusted", {
        eventId: record.eventId,
        state: record.state,
        reason: verdict.reason,
        note: "record cannot execute or be acknowledged; left for inspection",
      });
      continue;
    }
    pending.push({ eventId: record.eventId, envelope: verdict.envelope });
  }

  return pending;
}

/** Spool directory a producer writes newly received official envelopes into. */
export function systemEventInboxPath(dataDirectory: string): string {
  return path.join(dataDirectory, "system-events", "inbox");
}

export interface SpooledEnvelope {
  /** Absolute path of the spool file, so the caller can retire it once handled. */
  file: string;
  transportId: string;
  raw: unknown;
}

/**
 * Reads the spool without consuming it.
 *
 * Files are returned oldest-first by name (producers write a timestamp-ordered
 * prefix), and an unreadable or non-JSON file is reported as `raw: undefined`
 * so the caller retires it through the same rejection path as any other invalid
 * envelope rather than silently skipping it forever.
 */
export function readSystemEventInbox(inboxDirectory: string): SpooledEnvelope[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(inboxDirectory).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }

  return entries.sort().map((name) => {
    const file = path.join(inboxDirectory, name);
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      raw = undefined;
    }
    return { file, transportId: name.replace(/\.json$/, ""), raw };
  });
}

/**
 * Retires a spool file once its envelope is durably recorded (or provably
 * unusable). Rejected envelopes are moved aside rather than deleted so a
 * malformed producer is diagnosable after the fact.
 */
export function retireSpoolFile(file: string, outcome: "accepted" | "rejected"): void {
  try {
    if (outcome === "accepted") {
      fs.rmSync(file, { force: true });
      return;
    }
    const rejectedDirectory = path.join(path.dirname(file), "rejected");
    fs.mkdirSync(rejectedDirectory, { recursive: true });
    fs.renameSync(file, path.join(rejectedDirectory, path.basename(file)));
  } catch {
    // Best-effort: a spool file that cannot be retired is re-read next tick and
    // collapses onto the same ledger record, so it cannot cause double work.
  }
}

/** Convenience for producers (and tests): writes one envelope into the spool. */
export function spoolSystemEvent(
  inboxDirectory: string,
  envelope: unknown,
  transportId?: string
): string {
  fs.mkdirSync(inboxDirectory, { recursive: true });
  const id = (transportId ?? `${Date.now()}-${createHash("sha256")
    .update(JSON.stringify(envelope) ?? "")
    .digest("hex")
    .slice(0, 12)}`).replace(/[^A-Za-z0-9._-]/g, "_");
  const file = path.join(inboxDirectory, `${id}.json`);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
  return file;
}

/** Shape of a ledger record as exposed for diagnostics. Re-exported for callers. */
export type { LedgerRecord };
