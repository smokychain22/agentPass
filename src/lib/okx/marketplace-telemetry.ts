import { durableNow, getDurableRecord, setDurableRecord } from "@/lib/store/durable-store";
import { QUICK_TRIAGE_TIMEOUT_MS } from "@/lib/a2mcp/quick-triage-budget";
import type {
  AttestationSignerReadinessReason,
  GitHubAppReadinessReason,
  ReceiptSignerReadinessReason,
} from "@/lib/delivery/readiness";
import { probeDeliveryReadiness } from "@/lib/delivery/readiness";

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
  | "a2a_task_delivered"
  | "deep_scan_queued"
  | "deep_scan_ready";

export interface MarketplaceHealthSnapshot {
  a2mcpQuickTriageReady: boolean;
  a2mcpMaximumExecutionMs: number;
  a2mcpLastSuccessfulPaidCall: string | null;
  a2aRuntimeReady: boolean;
  a2aInitialResponseReady: boolean;
  /** Configured integrations present (env/probes). */
  configurationReady?: boolean;
  workerReady: boolean;
  workerReadySource: "authenticated_heartbeat" | "heartbeat" | "unset" | "github_actions_dispatcher";
  deepScanQueueReady: boolean;
  queueReady?: boolean;
  workerCapacityReady?: boolean;
  workflowReady?: boolean;
  githubAppReady: boolean;
  githubAppReadyReasons?: GitHubAppReadinessReason[];
  paymentVerifierReady: boolean;
  receiptSignerReady: boolean;
  receiptSignerReadyReasons?: ReceiptSignerReadinessReason[];
  attestationSignerReady: boolean;
  attestationSignerReadyReasons?: AttestationSignerReadinessReason[];
  queueDepth: number | null;
  activeWorkers: number;
  workerHeartbeatAgeMs: number | null;
  workerVersion?: string | null;
  activeJobs?: number;
  oldestQueuedTaskAgeSeconds?: number | null;
  /** Ephemeral GitHub Actions worker model */
  workerMode?: "github_actions_on_demand" | "always_on" | "unset";
  dispatcherReady?: boolean;
  dispatcherReadyReason?: string;
  dispatcherReadyMessage?: string;
  activeWorkflowRuns?: number;
  lastSuccessfulWorkerRun?: string | null;
  recentDispatchSuccessRate?: number | null;
  recentWorkerFailureRate?: number | null;
  degradedReasons?: string[];
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

function defaultHealth(): MarketplaceHealthSnapshot {
  return {
    a2mcpQuickTriageReady: true,
    a2mcpMaximumExecutionMs: QUICK_TRIAGE_TIMEOUT_MS,
    a2mcpLastSuccessfulPaidCall: null,
    a2aRuntimeReady: false,
    a2aInitialResponseReady: true,
    workerReady: false,
    workerReadySource: "unset",
    deepScanQueueReady: true,
    githubAppReady: false,
    paymentVerifierReady: false,
    receiptSignerReady: false,
    attestationSignerReady: false,
    queueDepth: null,
    activeWorkers: 0,
    workerHeartbeatAgeMs: null,
    workerMode: "github_actions_on_demand",
    dispatcherReady: false,
    activeWorkflowRuns: 0,
    lastSuccessfulWorkerRun: null,
    recentDispatchSuccessRate: null,
    recentWorkerFailureRate: null,
    updatedAt: durableNow(),
  };
}

export async function touchMarketplaceHealth(
  patch: Partial<MarketplaceHealthSnapshot>
): Promise<MarketplaceHealthSnapshot> {
  const existing =
    (await getDurableRecord<MarketplaceHealthSnapshot>("marketplace_deliveries", HEALTH_KEY)) ??
    defaultHealth();
  const updated: MarketplaceHealthSnapshot = {
    ...existing,
    ...patch,
    updatedAt: durableNow(),
  };
  await setDurableRecord("marketplace_deliveries", HEALTH_KEY, updated);
  return updated;
}

export async function getMarketplaceHealthSnapshot(): Promise<MarketplaceHealthSnapshot> {
  const existing =
    (await getDurableRecord<MarketplaceHealthSnapshot>("marketplace_deliveries", HEALTH_KEY)) ??
    defaultHealth();

  const { getLatestWorkerHeartbeat, isWorkerRecentlyOnline } = await import(
    "@/lib/worker/worker-instance-store"
  );
  const { getDeepScanCapacitySnapshot } = await import("@/lib/deep-scan/capacity");
  const { probeActionsDispatcherHealth } = await import(
    "@/lib/github-actions/dispatch-analysis"
  );
  const { getPersistentRecord } = await import("@/lib/store/persistent-store");
  const { listDeepScanQueueIds } = await import("@/lib/deep-scan/atomic-queue");
  const latest = await getLatestWorkerHeartbeat();
  const workerHeartbeatReady = isWorkerRecentlyOnline(latest);
  const heartbeatAgeMs = latest ? Date.now() - Date.parse(latest.heartbeatAt) : null;
  const capacity = await getDeepScanCapacitySnapshot();
  const a2aIntakeReady = existing.a2aInitialResponseReady !== false;
  const probe = await probeActionsDispatcherHealth();
  const dispatcherReady = probe.dispatcherReady;
  const deliveryReadiness = await probeDeliveryReadiness();

  const paymentVerifierReady = process.env.REQUIRE_REAL_X402 === "1";

  // Prefer ephemeral Actions dispatcher readiness when configured; daemon heartbeat is optional.
  const workerMode: MarketplaceHealthSnapshot["workerMode"] = dispatcherReady
    ? "github_actions_on_demand"
    : workerHeartbeatReady
      ? "always_on"
      : existing.workerMode ?? "unset";

  // Count live execution owners from durable jobs (not cached telemetry counters alone).
  const activeIndex =
    (await getPersistentRecord<string[]>("deep_scan_jobs", "active:index")) ?? [];
  const queueIds = await listDeepScanQueueIds();
  const allIds = Array.from(new Set([...activeIndex, ...queueIds]));
  let jobsWithWorkflowOrLease = 0;
  let undispatchedActive = 0;
  let oldestUndispatchedAgeSec: number | null = null;
  const now = Date.now();
  for (const id of allIds) {
    const job = await getPersistentRecord<{
      status?: string;
      stage?: string;
      workflowRunId?: string;
      claimedBy?: string;
      leaseExpiresAt?: string;
      createdAt?: string;
    }>("deep_scan_jobs", id);
    if (!job) continue;
    if (job.status === "complete" || job.status === "failed") continue;
    if (
      job.stage === "READY" ||
      job.stage === "COMPLETED" ||
      job.stage === "CANCELLED" ||
      job.stage === "FAILED_TERMINAL"
    ) {
      continue;
    }
    const leaseActive =
      Boolean(job.claimedBy) &&
      Boolean(job.leaseExpiresAt) &&
      Date.parse(job.leaseExpiresAt!) > now;
    if (job.workflowRunId || leaseActive) {
      jobsWithWorkflowOrLease += 1;
    } else {
      undispatchedActive += 1;
      if (job.createdAt) {
        const age = Math.max(0, Math.floor((now - Date.parse(job.createdAt)) / 1000));
        if (oldestUndispatchedAgeSec === null || age > oldestUndispatchedAgeSec) {
          oldestUndispatchedAgeSec = age;
        }
      }
    }
  }

  const queueDepth = capacity.queueDepth;
  const activeJobs = capacity.activeJobs;
  const activeFromDaemon = workerHeartbeatReady ? 1 : 0;
  const activeWorkers = Math.max(
    activeFromDaemon,
    jobsWithWorkflowOrLease > 0 ? Math.min(jobsWithWorkflowOrLease, activeJobs) : 0
  );
  const activeWorkflowRuns = jobsWithWorkflowOrLease;

  const configurationReady =
    dispatcherReady || workerHeartbeatReady || deliveryReadiness.githubAppReady;
  const queueReady = existing.deepScanQueueReady !== false;

  // On-demand: empty queue may be ready without an active worker.
  // Non-empty queue requires a workflow run, lease, or recent successful dispatch within grace.
  let workerCapacityReady = true;
  const degradedReasons: string[] = [];
  if (queueDepth > 0 || activeJobs > 0) {
    if (jobsWithWorkflowOrLease === 0 && undispatchedActive > 0) {
      workerCapacityReady = false;
      degradedReasons.push(
        `${undispatchedActive} active jobs have no workflow run or worker lease`
      );
      if (oldestUndispatchedAgeSec != null) {
        degradedReasons.push(
          `oldest undispatched job is ${oldestUndispatchedAgeSec} seconds old`
        );
      }
    }
  }

  const workflowReady =
    undispatchedActive === 0 ||
    (jobsWithWorkflowOrLease > 0 && undispatchedActive === 0) ||
    (queueDepth === 0 && activeJobs === 0);

  if (!dispatcherReady) {
    degradedReasons.push(probe.message ?? "Actions dispatcher not ready");
  }
  if (!deliveryReadiness.githubAppReady) {
    degradedReasons.push("GitHub App delivery not ready");
  }

  // workerReady = can start capacity when needed OR currently has capacity for backlog
  const workerReady =
    (queueDepth === 0 && activeJobs === 0 && (dispatcherReady || workerHeartbeatReady)) ||
    (workerCapacityReady && (dispatcherReady || workerHeartbeatReady || jobsWithWorkflowOrLease > 0));

  const a2aRuntimeReady =
    a2aIntakeReady &&
    dispatcherReady &&
    queueReady &&
    workerCapacityReady &&
    deliveryReadiness.githubAppReady &&
    deliveryReadiness.receiptSignerReady;

  if (!a2aRuntimeReady && a2aIntakeReady && !workerCapacityReady) {
    // already have capacity reasons
  } else if (!a2aRuntimeReady && !a2aIntakeReady) {
    degradedReasons.push("A2A intake acknowledgement not ready");
  }

  return {
    ...existing,
    a2mcpQuickTriageReady: existing.a2mcpQuickTriageReady !== false,
    a2mcpMaximumExecutionMs: existing.a2mcpMaximumExecutionMs || QUICK_TRIAGE_TIMEOUT_MS,
    a2aInitialResponseReady: a2aIntakeReady,
    configurationReady,
    queueReady,
    workerCapacityReady,
    workflowReady: workflowReady && undispatchedActive === 0,
    workerMode,
    dispatcherReady,
    dispatcherReadyReason: probe.reason,
    dispatcherReadyMessage: probe.message,
    workerReady,
    workerReadySource: dispatcherReady
      ? "github_actions_dispatcher"
      : workerHeartbeatReady
        ? "authenticated_heartbeat"
        : "unset",
    a2aRuntimeReady,
    deepScanQueueReady: queueReady,
    githubAppReady: deliveryReadiness.githubAppReady,
    githubAppReadyReasons: deliveryReadiness.githubApp.reasons,
    paymentVerifierReady,
    receiptSignerReady: deliveryReadiness.receiptSignerReady,
    receiptSignerReadyReasons: deliveryReadiness.receiptSigner.reasons,
    attestationSignerReady: deliveryReadiness.attestationSignerReady,
    attestationSignerReadyReasons: deliveryReadiness.attestationSigner.reasons,
    queueDepth,
    activeWorkers,
    activeWorkflowRuns,
    workerHeartbeatAgeMs: heartbeatAgeMs,
    workerVersion: latest?.version ?? existing.workerVersion ?? null,
    activeJobs,
    oldestQueuedTaskAgeSeconds: capacity.oldestQueuedTaskAgeSeconds,
    lastSuccessfulWorkerRun: existing.lastSuccessfulWorkerRun ?? null,
    recentDispatchSuccessRate: existing.recentDispatchSuccessRate ?? null,
    recentWorkerFailureRate: existing.recentWorkerFailureRate ?? null,
    degradedReasons: degradedReasons.length > 0 ? degradedReasons : undefined,
    updatedAt: durableNow(),
  };
}
