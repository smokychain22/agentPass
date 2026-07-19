import { durableNow, getDurableRecord, setDurableRecord } from "@/lib/store/durable-store";
import type { OkxMarketplaceLifecycleState } from "@/lib/a2a/okx-marketplace-lifecycle";

export interface AgentRuntimeHealth {
  agentOnline: boolean;
  onchainOsAuthenticated: boolean;
  lastTaskReceivedAt: string | null;
  lastAcknowledgementAt: string | null;
  queueDepth: number;
  oldestUnacknowledgedTaskAgeSeconds: number | null;
  failedTaskCount: number;
  modelProviderAvailable: boolean;
  a2mcpEndpointHealthy: boolean;
  deliveryWorkerHealthy: boolean;
  alertAgentCannotAnswer: boolean;
  lastSeenAt: string;
  updatedAt: string;
}

const HEALTH_KEY = "agent_runtime_health";

function defaultHealth(): AgentRuntimeHealth {
  return {
    agentOnline: false,
    onchainOsAuthenticated: process.env.REPODIET_ONCHAIN_OS_AUTHENTICATED === "1",
    lastTaskReceivedAt: null,
    lastAcknowledgementAt: null,
    queueDepth: 0,
    oldestUnacknowledgedTaskAgeSeconds: null,
    failedTaskCount: 0,
    modelProviderAvailable: process.env.REPODIET_MODEL_PROVIDER_AVAILABLE !== "0",
    a2mcpEndpointHealthy: false,
    deliveryWorkerHealthy: process.env.REPODIET_WORKER_UNAVAILABLE !== "1",
    alertAgentCannotAnswer: true,
    lastSeenAt: durableNow(),
    updatedAt: durableNow(),
  };
}

export async function getAgentRuntimeHealth(): Promise<AgentRuntimeHealth> {
  const existing =
    (await getDurableRecord<AgentRuntimeHealth>("marketplace_deliveries", HEALTH_KEY)) ??
    defaultHealth();

  const alertAgentCannotAnswer =
    !existing.agentOnline ||
    existing.onchainOsAuthenticated === false ||
    (existing.oldestUnacknowledgedTaskAgeSeconds != null &&
      existing.oldestUnacknowledgedTaskAgeSeconds > 120);

  return {
    ...existing,
    deliveryWorkerHealthy: process.env.REPODIET_WORKER_UNAVAILABLE !== "1",
    onchainOsAuthenticated: process.env.REPODIET_ONCHAIN_OS_AUTHENTICATED !== "0",
    alertAgentCannotAnswer,
    lastSeenAt: durableNow(),
    updatedAt: durableNow(),
  };
}

export async function touchAgentRuntimeHealth(
  patch: Partial<AgentRuntimeHealth>
): Promise<AgentRuntimeHealth> {
  const existing = await getAgentRuntimeHealth();
  const updated: AgentRuntimeHealth = {
    ...existing,
    ...patch,
    updatedAt: durableNow(),
    lastSeenAt: durableNow(),
  };
  updated.alertAgentCannotAnswer =
    !updated.agentOnline ||
    updated.onchainOsAuthenticated === false ||
    (updated.oldestUnacknowledgedTaskAgeSeconds != null &&
      updated.oldestUnacknowledgedTaskAgeSeconds > 120);
  await setDurableRecord("marketplace_deliveries", HEALTH_KEY, updated);
  return updated;
}

export async function recordInboundTaskReceived(): Promise<void> {
  await touchAgentRuntimeHealth({
    agentOnline: true,
    lastTaskReceivedAt: durableNow(),
  });
}

export async function recordTaskAcknowledged(input?: {
  queueDepth?: number;
  lifecycle?: OkxMarketplaceLifecycleState;
}): Promise<void> {
  await touchAgentRuntimeHealth({
    agentOnline: true,
    lastAcknowledgementAt: durableNow(),
    queueDepth: input?.queueDepth ?? 0,
    oldestUnacknowledgedTaskAgeSeconds: 0,
  });
}
