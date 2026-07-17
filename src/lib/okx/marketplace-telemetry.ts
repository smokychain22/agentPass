import { durableNow, getDurableRecord, setDurableRecord } from "@/lib/store/durable-store";
import { QUICK_TRIAGE_TIMEOUT_MS } from "@/lib/a2mcp/quick-triage-budget";

export type MarketplaceTelemetryEvent =
  | "a2mcp_request_received"
  | "a2mcp_402_issued"
  | "a2mcp_payment_verified"
  | "a2mcp_entitlement_state"
  | "a2mcp_business_started"
  | "a2mcp_business_completed"
  | "a2mcp_response_duration"
  | "a2mcp_result_persisted"
  | "a2mcp_receipt_persisted"
  | "a2mcp_replay_served"
  | "a2a_message_received"
  | "a2a_acknowledgement_sent"
  | "a2a_task_queued"
  | "a2a_task_delivered";

export interface MarketplaceHealthSnapshot {
  a2mcpQuickTriageReady: boolean;
  a2mcpMaximumExecutionMs: number;
  a2mcpLastSuccessfulPaidCall: string | null;
  a2aRuntimeReady: boolean;
  a2aInitialResponseReady: boolean;
  workerReady: boolean;
  updatedAt: string;
}

const HEALTH_KEY = "marketplace_health_snapshot";

const REDACT_KEYS = [
  "paymentSignature",
  "payment-signature",
  "secret",
  "token",
  "passphrase",
  "apiKey",
  "privateKey",
  "otp",
  "session",
];

function redactValue(key: string, value: unknown): unknown {
  const lower = key.toLowerCase();
  if (REDACT_KEYS.some((needle) => lower.includes(needle))) return "[redacted]";
  if (typeof value === "string" && value.length > 120) return `${value.slice(0, 40)}…[truncated]`;
  return value;
}

export function redactTelemetryPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = redactTelemetryPayload(value as Record<string, unknown>);
    } else {
      out[key] = redactValue(key, value);
    }
  }
  return out;
}

export function logMarketplaceTelemetry(
  event: MarketplaceTelemetryEvent,
  payload: Record<string, unknown> = {}
): void {
  const safe = redactTelemetryPayload(payload);
  console.info(
    JSON.stringify({
      component: "okx-marketplace",
      event,
      at: durableNow(),
      ...safe,
    })
  );
}

export async function touchMarketplaceHealth(
  patch: Partial<MarketplaceHealthSnapshot>
): Promise<MarketplaceHealthSnapshot> {
  const existing =
    (await getDurableRecord<MarketplaceHealthSnapshot>("marketplace_deliveries", HEALTH_KEY)) ?? defaultHealth();
  const updated: MarketplaceHealthSnapshot = {
    ...existing,
    ...patch,
    updatedAt: durableNow(),
  };
  await setDurableRecord("marketplace_deliveries", HEALTH_KEY, updated);
  return updated;
}

export async function getMarketplaceHealthSnapshot(): Promise<MarketplaceHealthSnapshot> {
  return (
    (await getDurableRecord<MarketplaceHealthSnapshot>("marketplace_deliveries", HEALTH_KEY)) ??
    defaultHealth()
  );
}

function defaultHealth(): MarketplaceHealthSnapshot {
  const workerReady =
    Boolean(process.env.WORKER_API_KEY?.trim()) || process.env.NODE_ENV !== "production";
  return {
    a2mcpQuickTriageReady: true,
    a2mcpMaximumExecutionMs: QUICK_TRIAGE_TIMEOUT_MS,
    a2mcpLastSuccessfulPaidCall: null,
    a2aRuntimeReady: true,
    a2aInitialResponseReady: true,
    workerReady,
    updatedAt: durableNow(),
  };
}
