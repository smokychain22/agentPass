import { durableNow, getDurableRecord, setDurableRecord } from "@/lib/store/durable-store";
import type { OkxMarketplaceLifecycleState } from "@/lib/a2a/okx-marketplace-lifecycle";
import { REPODIET_OKX_SERVICES } from "@/lib/okx-runtime/service-selection";

export interface AgentRuntimeHealth {
  agentOnline: boolean;
  onchainOsAuthenticated: boolean;
  officialWatchActive: boolean;
  xmtpClientReady: boolean;
  aspAgentId: string | null;
  a2aServiceId: string | null;
  sellerWallet: string | null;
  registeredCommunicationAddress: string | null;
  recoveredSignerAddress: string | null;
  identityVerifiedAt: string | null;
  heartbeatExpiresAt: string | null;
  heartbeatStatus: "missing" | "fresh" | "expired" | "identity_mismatch";
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
  /** Durable Windows Task Scheduler runtime process, reported by each heartbeat tick. */
  workerPid: number | null;
  /** Count of duplicate-instance starts the runtime's own lock file has refused. */
  duplicateWorkerAttemptCount: number;
  /** Count of inbound reviewer/marketplace requests received (POST /api/a2a/tasks). */
  reviewerRequestCount: number;
  lastReviewerRequestAt: string | null;
  lastReviewerResponseAt: string | null;
  lastReviewerResponseLatencyMs: number | null;
}

const HEALTH_KEY = "agent_runtime_health";

function defaultHealth(): AgentRuntimeHealth {
  return {
    agentOnline: false,
    onchainOsAuthenticated: false,
    officialWatchActive: false,
    xmtpClientReady: false,
    aspAgentId: null,
    a2aServiceId: null,
    sellerWallet: null,
    registeredCommunicationAddress: null,
    recoveredSignerAddress: null,
    identityVerifiedAt: null,
    heartbeatExpiresAt: null,
    heartbeatStatus: "missing",
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
    workerPid: null,
    duplicateWorkerAttemptCount: 0,
    reviewerRequestCount: 0,
    lastReviewerRequestAt: null,
    lastReviewerResponseAt: null,
    lastReviewerResponseLatencyMs: null,
  };
}

function sameAddress(left: string | null | undefined, right: string): boolean {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

export function deriveAgentRuntimeHealth(
  stored: AgentRuntimeHealth,
  nowMs = Date.now()
): AgentRuntimeHealth {
  const expected = REPODIET_OKX_SERVICES.a2a;
  const hasHeartbeat = Boolean(stored.identityVerifiedAt && stored.heartbeatExpiresAt);
  const identityMatches =
    stored.aspAgentId === expected.agentId &&
    stored.a2aServiceId === expected.serviceId &&
    sameAddress(stored.sellerWallet, expected.sellerWallet) &&
    sameAddress(stored.registeredCommunicationAddress, expected.communicationAddress) &&
    sameAddress(stored.recoveredSignerAddress, expected.communicationAddress);
  const expiresAtMs = stored.heartbeatExpiresAt
    ? Date.parse(stored.heartbeatExpiresAt)
    : Number.NaN;
  const heartbeatFresh =
    hasHeartbeat && Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
  const runtimeReady =
    identityMatches &&
    heartbeatFresh &&
    stored.onchainOsAuthenticated === true &&
    stored.officialWatchActive === true &&
    stored.xmtpClientReady === true;
  const heartbeatStatus: AgentRuntimeHealth["heartbeatStatus"] = !hasHeartbeat
    ? "missing"
    : !identityMatches
      ? "identity_mismatch"
      : heartbeatFresh
        ? "fresh"
        : "expired";

  const alertAgentCannotAnswer =
    !runtimeReady ||
    (stored.oldestUnacknowledgedTaskAgeSeconds != null &&
      stored.oldestUnacknowledgedTaskAgeSeconds > 120);

  return {
    ...stored,
    agentOnline: runtimeReady,
    onchainOsAuthenticated: runtimeReady && stored.onchainOsAuthenticated,
    officialWatchActive: runtimeReady && stored.officialWatchActive,
    xmtpClientReady: runtimeReady && stored.xmtpClientReady,
    heartbeatStatus,
    deliveryWorkerHealthy: process.env.REPODIET_WORKER_UNAVAILABLE !== "1",
    alertAgentCannotAnswer,
  };
}

async function getStoredAgentRuntimeHealth(): Promise<AgentRuntimeHealth> {
  const existing = await getDurableRecord<Partial<AgentRuntimeHealth>>(
    "marketplace_deliveries",
    HEALTH_KEY
  );
  return {
    ...defaultHealth(),
    ...existing,
  };
}

export async function getAgentRuntimeHealth(): Promise<AgentRuntimeHealth> {
  return deriveAgentRuntimeHealth(await getStoredAgentRuntimeHealth());
}

type AgentRuntimeObservationPatch = Partial<
  Pick<
    AgentRuntimeHealth,
    | "lastTaskReceivedAt"
    | "lastAcknowledgementAt"
    | "queueDepth"
    | "oldestUnacknowledgedTaskAgeSeconds"
    | "failedTaskCount"
    | "modelProviderAvailable"
    | "a2mcpEndpointHealthy"
    | "deliveryWorkerHealthy"
    | "reviewerRequestCount"
    | "lastReviewerRequestAt"
    | "lastReviewerResponseAt"
    | "lastReviewerResponseLatencyMs"
  >
>;

export async function touchAgentRuntimeHealth(
  patch: AgentRuntimeObservationPatch
): Promise<AgentRuntimeHealth> {
  const existing = await getStoredAgentRuntimeHealth();
  const updated: AgentRuntimeHealth = {
    ...existing,
    ...patch,
    updatedAt: durableNow(),
  };
  await setDurableRecord("marketplace_deliveries", HEALTH_KEY, updated);
  return deriveAgentRuntimeHealth(updated);
}

export interface VerifiedAgentRuntimeHeartbeat {
  aspAgentId: string;
  a2aServiceId: string;
  sellerWallet: string;
  registeredCommunicationAddress: string;
  recoveredSignerAddress: string;
  onchainOsAuthenticated: true;
  officialWatchActive: true;
  xmtpClientReady: true;
  ttlSeconds?: number;
  /** Reported by the durable Task Scheduler runtime for observability only — never trusted for identity. */
  workerPid?: number;
  duplicateWorkerAttemptCount?: number;
}

export async function recordVerifiedAgentRuntimeHeartbeat(
  input: VerifiedAgentRuntimeHeartbeat
): Promise<AgentRuntimeHealth> {
  const expected = REPODIET_OKX_SERVICES.a2a;
  if (
    input.aspAgentId !== expected.agentId ||
    input.a2aServiceId !== expected.serviceId ||
    !sameAddress(input.sellerWallet, expected.sellerWallet) ||
    !sameAddress(input.registeredCommunicationAddress, expected.communicationAddress) ||
    !sameAddress(input.recoveredSignerAddress, expected.communicationAddress)
  ) {
    throw new Error("official_seller_identity_mismatch");
  }

  const ttlSeconds = Math.max(15, Math.min(300, Math.floor(input.ttlSeconds ?? 90)));
  const now = durableNow();
  const existing = await getStoredAgentRuntimeHealth();
  const updated: AgentRuntimeHealth = {
    ...existing,
    agentOnline: true,
    onchainOsAuthenticated: true,
    officialWatchActive: true,
    xmtpClientReady: true,
    aspAgentId: input.aspAgentId,
    a2aServiceId: input.a2aServiceId,
    sellerWallet: input.sellerWallet.toLowerCase(),
    registeredCommunicationAddress: input.registeredCommunicationAddress.toLowerCase(),
    recoveredSignerAddress: input.recoveredSignerAddress.toLowerCase(),
    identityVerifiedAt: now,
    heartbeatExpiresAt: new Date(Date.parse(now) + ttlSeconds * 1_000).toISOString(),
    heartbeatStatus: "fresh",
    alertAgentCannotAnswer: false,
    lastSeenAt: now,
    updatedAt: now,
    workerPid: input.workerPid ?? existing.workerPid,
    duplicateWorkerAttemptCount: input.duplicateWorkerAttemptCount ?? existing.duplicateWorkerAttemptCount,
  };
  await setDurableRecord("marketplace_deliveries", HEALTH_KEY, updated);
  return deriveAgentRuntimeHealth(updated);
}

export async function recordInboundTaskReceived(): Promise<void> {
  const now = durableNow();
  const existing = await getStoredAgentRuntimeHealth();
  await touchAgentRuntimeHealth({
    lastTaskReceivedAt: now,
    lastReviewerRequestAt: now,
    reviewerRequestCount: (existing.reviewerRequestCount ?? 0) + 1,
  });
}

export async function recordTaskAcknowledged(input?: {
  queueDepth?: number;
  lifecycle?: OkxMarketplaceLifecycleState;
  responseLatencyMs?: number;
}): Promise<void> {
  const now = durableNow();
  await touchAgentRuntimeHealth({
    lastAcknowledgementAt: now,
    queueDepth: input?.queueDepth ?? 0,
    oldestUnacknowledgedTaskAgeSeconds: 0,
    lastReviewerResponseAt: now,
    lastReviewerResponseLatencyMs: input?.responseLatencyMs ?? null,
  });
}
