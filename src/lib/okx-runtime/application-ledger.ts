/**
 * Durable provider-application ledger, on the mounted volume (/persistent) so
 * it survives machine restarts and image redeploys.
 *
 * Kept separate from the system-event action ledger on purpose: that one is
 * keyed by EVENT, and an application is keyed by JOB. A job can be reached by
 * several distinct events (an initial `job_asp_selected`, a later
 * `wakeup_notify`, a reconciliation sweep with no event at all), and all of
 * them must resolve to the same single "have we already applied for this job"
 * answer. Keying by event would let two different events each conclude "no
 * record" and both broadcast.
 *
 * Same durability rules as action-ledger.ts: atomic writes, and a corrupt file
 * FAILS CLOSED rather than reading as "never applied" — which would licence
 * exactly the duplicate broadcast this exists to prevent.
 */
import fs from "node:fs";
import path from "node:path";

import type { PriorApplication } from "./provider-apply";

export interface ApplicationRecord extends PriorApplication {
  updatedAt: string;
}

interface ApplicationLedgerFile {
  version: 1;
  providerAgentId: string;
  applications: Record<string, ApplicationRecord>;
}

export class ApplicationLedgerCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplicationLedgerCorruptionError";
  }
}

function atomicWriteJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

export class FileApplicationLedger {
  constructor(
    private readonly file: string,
    private readonly providerAgentId: string
  ) {}

  private load(): ApplicationLedgerFile {
    if (!fs.existsSync(this.file)) {
      return { version: 1, providerAgentId: this.providerAgentId, applications: {} };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch (err) {
      throw new ApplicationLedgerCorruptionError(
        `application_ledger_malformed: ${(err as Error).message}`
      );
    }
    const file = parsed as ApplicationLedgerFile;
    if (
      !file ||
      typeof file !== "object" ||
      file.version !== 1 ||
      typeof file.applications !== "object" ||
      file.applications === null
    ) {
      throw new ApplicationLedgerCorruptionError("application_ledger_bad_shape");
    }
    if (file.providerAgentId !== this.providerAgentId) {
      // Another provider's application history must never be read as ours.
      throw new ApplicationLedgerCorruptionError("application_ledger_provider_mismatch");
    }
    return file;
  }

  async get(key: string): Promise<ApplicationRecord | undefined> {
    return this.load().applications[key];
  }

  async put(key: string, record: ApplicationRecord): Promise<void> {
    const file = this.load();
    const existing = file.applications[key];
    // `applied` is terminal and never downgraded. A late-arriving `failed` or
    // `uncertain` for a job we have already confirmed must not reopen it —
    // that would licence a second broadcast.
    if (existing?.state === "applied" && record.state !== "applied") return;
    file.applications[key] = {
      ...existing,
      ...record,
      // Never lose the original transaction reference to a later update.
      transactionRef: record.transactionRef ?? existing?.transactionRef,
    };
    atomicWriteJson(this.file, file);
  }

  /** Every recorded application, for reporting and reconciliation. */
  all(): ApplicationRecord[] {
    return Object.values(this.load().applications);
  }
}

export function applicationLedgerPath(dataDirectory: string): string {
  return path.join(dataDirectory, "provider-applications.json");
}
