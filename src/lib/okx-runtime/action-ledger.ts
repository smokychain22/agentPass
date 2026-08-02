/**
 * Crash-safe, process-safe action ledger for official OKX system events,
 * persisted on the mounted volume (/persistent) so it survives machine
 * restarts and image redeploys.
 *
 * This is the record that makes "never repeat an on-chain action" true across
 * process death. Its correctness rules, in order of importance:
 *
 *  1. Evidence is durable BEFORE the caller acts on it. Every mutation is an
 *     atomic write (temp file + rename), so a crash mid-write leaves the
 *     previous good file, never a half-written one.
 *  2. A malformed or corrupt ledger FAILS CLOSED. It is never silently reset,
 *     because "no record" reads as "never broadcast", which would licence a
 *     duplicate transaction. Corruption is quarantined and the runtime refuses
 *     to execute rather than risk replay.
 *  3. Locks are process-safe and stale-tolerant. A lock held by a dead PID is
 *     reclaimable; a lock held by a live one is not.
 *  4. No secret material is ever written. Only identifiers, states, digests
 *     and argv — argv is validated by the authorization boundary before it
 *     gets here, and model/API credentials never enter this structure.
 */
import fs from "node:fs";
import path from "node:path";

import type { EventLifecycleState, ProposedAction } from "./system-event-route";

export interface LedgerRecord {
  eventId: string;
  semanticKey: string;
  jobId: string;
  sessionKey?: string;
  buyerAgentId?: string;
  providerAgentId: string;
  serviceId?: string;
  state: EventLifecycleState;
  instructionDigest?: string;
  model?: string;
  modelInvocationId?: string;
  proposedAction?: ProposedAction;
  authorizedAction?: ProposedAction;
  argv?: string[];
  transactionRef?: string;
  branchRef?: string;
  commitRef?: string;
  pullRequestUrl?: string;
  xmtpOutboundId?: string;
  attempts: number;
  retryAfterIso?: string;
  acknowledged: boolean;
  terminalReason?: string;
  createdAt: string;
  updatedAt: string;
}

interface LedgerFile {
  version: 1;
  providerAgentId: string;
  records: Record<string, LedgerRecord>;
}

/** Terminal records older than this are pruned to bound file growth. */
const RETAIN_TERMINAL_MS = 30 * 24 * 60 * 60 * 1000;
/** A lock whose owning PID is gone and which is older than this is stale. */
const LOCK_STALE_MS = 10 * 60 * 1000;
/** Hard cap so a pathological event stream cannot grow the file without bound. */
const MAX_RECORDS = 5_000;

export class LedgerCorruptionError extends Error {
  constructor(
    message: string,
    readonly quarantinePath?: string
  ) {
    super(message);
    this.name = "LedgerCorruptionError";
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function atomicWriteJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // PID-scoped temp name so two processes cannot collide on the same temp file.
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

function processAlive(pid: number): boolean {
  try {
    // Signal 0 performs the permission/existence check without delivering.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists but belongs to another user — still alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class FileActionLedger {
  private readonly lockDirectory: string;
  private readonly held = new Set<string>();

  constructor(
    private readonly file: string,
    private readonly providerAgentId: string
  ) {
    this.lockDirectory = `${file}.locks`;
  }

  /**
   * Reads and validates. Throws LedgerCorruptionError rather than returning an
   * empty ledger — see rule 2 above: an empty read would licence replay.
   */
  private load(): LedgerFile {
    if (!fs.existsSync(this.file)) {
      return { version: 1, providerAgentId: this.providerAgentId, records: {} };
    }

    let raw: string;
    try {
      raw = fs.readFileSync(this.file, "utf8");
    } catch (err) {
      throw new LedgerCorruptionError(`ledger_unreadable: ${(err as Error).message}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new LedgerCorruptionError(`ledger_malformed_json: ${this.quarantine()}`);
    }

    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as LedgerFile).version !== 1 ||
      typeof (parsed as LedgerFile).records !== "object" ||
      (parsed as LedgerFile).records === null
    ) {
      throw new LedgerCorruptionError(`ledger_bad_shape: ${this.quarantine()}`);
    }

    const file = parsed as LedgerFile;
    if (file.providerAgentId !== this.providerAgentId) {
      // A ledger belonging to a different provider must never be treated as
      // ours — its transaction history would be misread as our own.
      throw new LedgerCorruptionError("ledger_provider_mismatch");
    }
    return file;
  }

  /** Moves a corrupt file aside for operator inspection; never deletes it. */
  private quarantine(): string {
    const target = `${this.file}.corrupt.${Date.now()}`;
    try {
      fs.renameSync(this.file, target);
    } catch {
      return "quarantine_failed";
    }
    return target;
  }

  get(eventId: string): LedgerRecord | undefined {
    return this.load().records[eventId];
  }

  /** Finds a prior record for the same semantic identity (duplicate delivery). */
  findBySemanticKey(semanticKey: string): LedgerRecord | undefined {
    return Object.values(this.load().records).find((r) => r.semanticKey === semanticKey);
  }

  put(eventId: string, patch: Partial<LedgerRecord> & { state: EventLifecycleState }): LedgerRecord {
    const file = this.load();
    const existing = file.records[eventId];
    // Spreads FIRST so prior evidence (transactionRef, branch, PR url) carries
    // forward, then the authoritative fields, which a patch must not be able to
    // override — notably providerAgentId, which is always this ledger's owner
    // and never whatever a caller or a stale record claims.
    const record: LedgerRecord = {
      ...existing,
      ...patch,
      eventId,
      providerAgentId: this.providerAgentId,
      state: patch.state,
      semanticKey: patch.semanticKey ?? existing?.semanticKey ?? eventId,
      jobId: patch.jobId ?? existing?.jobId ?? "",
      attempts: patch.attempts ?? existing?.attempts ?? 0,
      acknowledged: patch.acknowledged ?? existing?.acknowledged ?? false,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    };
    file.records[eventId] = record;
    this.prune(file);
    atomicWriteJson(this.file, file);
    return record;
  }

  /**
   * Bounds growth without ever dropping a record that could still authorize or
   * forbid an action: only acknowledged/terminal records past the retention
   * window are eligible.
   */
  private prune(file: LedgerFile): void {
    const entries = Object.entries(file.records);
    if (entries.length <= MAX_RECORDS) {
      const cutoff = Date.now() - RETAIN_TERMINAL_MS;
      for (const [id, record] of entries) {
        if (!record.acknowledged && record.state !== "terminal_failure") continue;
        if (Date.parse(record.updatedAt) < cutoff) delete file.records[id];
      }
      return;
    }
    // Over the hard cap: drop the oldest finished records first, newest last.
    const finished = entries
      .filter(([, r]) => r.acknowledged || r.state === "terminal_failure")
      .sort((a, b) => Date.parse(a[1].updatedAt) - Date.parse(b[1].updatedAt));
    for (const [id] of finished.slice(0, entries.length - MAX_RECORDS)) {
      delete file.records[id];
    }
  }

  /**
   * Exclusive claim via atomic directory creation — `mkdir` is atomic on both
   * POSIX and Windows, so two processes racing cannot both win.
   */
  tryLock(eventId: string): boolean {
    const lock = path.join(this.lockDirectory, `${encodeURIComponent(eventId)}.lock`);
    fs.mkdirSync(this.lockDirectory, { recursive: true });

    try {
      fs.mkdirSync(lock);
      fs.writeFileSync(path.join(lock, "owner"), String(process.pid), "utf8");
      this.held.add(eventId);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }

    // Existing lock: reclaim only if its owner is provably gone.
    try {
      const ownerFile = path.join(lock, "owner");
      const stat = fs.statSync(lock);
      const owner = Number(fs.readFileSync(ownerFile, "utf8").trim());
      const expired = Date.now() - stat.mtimeMs > LOCK_STALE_MS;
      if (Number.isFinite(owner) && processAlive(owner)) return false;
      if (!expired) return false;

      fs.rmSync(lock, { recursive: true, force: true });
      fs.mkdirSync(lock);
      fs.writeFileSync(ownerFile, String(process.pid), "utf8");
      this.held.add(eventId);
      return true;
    } catch {
      return false;
    }
  }

  unlock(eventId: string): void {
    if (!this.held.has(eventId)) return;
    const lock = path.join(this.lockDirectory, `${encodeURIComponent(eventId)}.lock`);
    fs.rmSync(lock, { recursive: true, force: true });
    this.held.delete(eventId);
  }

  /** Unfinished events to resume after a restart, oldest first. */
  pendingForRecovery(): LedgerRecord[] {
    return Object.values(this.load().records)
      .filter((r) => !r.acknowledged && r.state !== "terminal_failure")
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }
}

/** Ledger location on the mounted volume. */
export function actionLedgerPath(dataDirectory: string): string {
  return path.join(dataDirectory, "action-ledger.json");
}
