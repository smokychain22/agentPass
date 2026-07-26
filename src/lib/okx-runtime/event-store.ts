import fs from "node:fs";
import path from "node:path";

export interface DurableEventCheckpoint {
  version: 1;
  agentId: string;
  walletAddress: string;
  lastCursor?: string;
  activeJobIds: string[];
  events: Record<
    string,
    {
      semanticKey: string;
      jobId?: string;
      state: "processing" | "acknowledged" | "failed";
      attempts: number;
      updatedAt: string;
      error?: string;
    }
  >;
}

function emptyCheckpoint(agentId: string, walletAddress: string): DurableEventCheckpoint {
  return {
    version: 1,
    agentId,
    walletAddress: walletAddress.toLowerCase(),
    activeJobIds: [],
    events: {},
  };
}

function atomicWrite(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

export class DurableEventStore {
  constructor(
    private readonly file: string,
    private readonly agentId: string,
    private readonly walletAddress: string
  ) {}

  read(): DurableEventCheckpoint {
    if (!fs.existsSync(this.file)) {
      return emptyCheckpoint(this.agentId, this.walletAddress);
    }
    const value = JSON.parse(fs.readFileSync(this.file, "utf8")) as DurableEventCheckpoint;
    if (value.agentId !== this.agentId) throw new Error("event_store_agent_mismatch");
    if (value.walletAddress.toLowerCase() !== this.walletAddress.toLowerCase()) {
      throw new Error("event_store_wallet_mismatch");
    }
    return value;
  }

  begin(input: {
    eventId: string;
    semanticKey: string;
    jobId?: string;
  }): { duplicate: boolean; checkpoint: DurableEventCheckpoint } {
    const checkpoint = this.read();
    const duplicate = Object.values(checkpoint.events).some(
      (event) =>
        event.semanticKey === input.semanticKey &&
        (event.state === "processing" || event.state === "acknowledged")
    );
    if (duplicate) return { duplicate: true, checkpoint };

    const previous = checkpoint.events[input.eventId];
    checkpoint.events[input.eventId] = {
      semanticKey: input.semanticKey,
      jobId: input.jobId,
      state: "processing",
      attempts: (previous?.attempts ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    if (input.jobId && !checkpoint.activeJobIds.includes(input.jobId)) {
      checkpoint.activeJobIds.push(input.jobId);
    }
    atomicWrite(this.file, checkpoint);
    return { duplicate: false, checkpoint };
  }

  acknowledge(eventId: string, cursor?: string): void {
    const checkpoint = this.read();
    const event = checkpoint.events[eventId];
    if (!event) throw new Error("event_not_started");
    event.state = "acknowledged";
    event.updatedAt = new Date().toISOString();
    delete event.error;
    if (cursor) checkpoint.lastCursor = cursor;
    atomicWrite(this.file, checkpoint);
  }

  fail(eventId: string, error: string): void {
    const checkpoint = this.read();
    const event = checkpoint.events[eventId];
    if (!event) throw new Error("event_not_started");
    event.state = "failed";
    event.error = error;
    event.updatedAt = new Date().toISOString();
    atomicWrite(this.file, checkpoint);
  }

  replayCursor(jobId?: string): string | undefined {
    const checkpoint = this.read();
    if (!jobId || checkpoint.activeJobIds.includes(jobId)) return checkpoint.lastCursor;
    return undefined;
  }
}
