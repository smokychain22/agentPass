import { createHash } from "node:crypto";
import { DurableEventStore } from "./event-store";
import { runProcess, type ProcessRunResult } from "./process-runner";

export interface ProviderSystemEvent {
  eventId: string;
  event: string;
  jobId: string;
  cursor?: string;
  payload: Record<string, unknown>;
}

export interface ProviderWorkerOptions {
  executable: string;
  agentId: string;
  store: DurableEventStore;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  runner?: typeof runProcess;
}

function semanticEventKey(event: ProviderSystemEvent): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        agentId: "5283",
        event: event.event,
        jobId: event.jobId,
        payload: event.payload,
      })
    )
    .digest("hex");
}

export async function acknowledgeProviderEvent(
  event: ProviderSystemEvent,
  options: ProviderWorkerOptions
): Promise<ProcessRunResult & { duplicate: boolean; latencyMs: number }> {
  if (options.agentId !== "5283") throw new Error("seller_agent_identity_mismatch");
  const started = Date.now();
  const semanticKey = semanticEventKey(event);
  const claim = options.store.begin({
    eventId: event.eventId,
    semanticKey,
    jobId: event.jobId,
  });
  if (claim.duplicate) {
    return {
      ok: true,
      duplicate: true,
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      cancelled: false,
      latencyMs: Date.now() - started,
    };
  }

  const runner = options.runner ?? runProcess;
  const message = JSON.stringify({
    event: event.event,
    jobId: event.jobId,
    ...event.payload,
  });
  const result = await runner(
    options.executable,
    [
      "agent",
      "next-action",
      "--role",
      "asp",
      "--agentId",
      options.agentId,
      "--message",
      message,
    ],
    {
      env: options.env,
      timeoutMs: options.timeoutMs ?? 8_000,
    }
  );

  if (result.ok) {
    options.store.acknowledge(event.eventId, event.cursor);
  } else {
    options.store.fail(
      event.eventId,
      result.timedOut ? "provider_ack_timeout" : result.stderr || "provider_ack_failed"
    );
  }

  return { ...result, duplicate: false, latencyMs: Date.now() - started };
}
