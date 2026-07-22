import { resolveEntitlementMode } from "@/lib/entitlement/service";
import { getLastStaleQueueReconciliationReport } from "@/lib/deep-scan/reconcile-stale";
import { isOkxPaidMode } from "./entitlement";
import { buildOperatorProfile } from "./operator-identity";
import { listOkxServices } from "./services";
import { getMarketplaceHealthSnapshot } from "./marketplace-telemetry";
import { getAgentRuntimeHealth } from "@/lib/a2a/agent-runtime-health";
import { getPaymentEnvironment } from "@/lib/payment/payment-environment";

export async function buildOkxHealthResponse() {
  const marketplace = await getMarketplaceHealthSnapshot();
  const agentRuntime = await getAgentRuntimeHealth();
  const staleQueueReport = await getLastStaleQueueReconciliationReport();
  const paymentEnv = getPaymentEnvironment();
  const heartbeatAgeSeconds =
    marketplace.workerHeartbeatAgeMs == null
      ? null
      : Math.max(0, Math.floor(marketplace.workerHeartbeatAgeMs / 1000));

  const queueDepth = marketplace.queueDepth ?? 0;
  const activeJobs = marketplace.activeJobs ?? 0;
  const activeWorkers = marketplace.activeWorkers ?? 0;
  const activeWorkflowRuns = marketplace.activeWorkflowRuns ?? 0;
  const backlogWithoutExecutor =
    (queueDepth > 0 || activeJobs > 0) && activeWorkers === 0 && activeWorkflowRuns === 0;

  const degradedReasons = [
    ...(marketplace.degradedReasons ?? []),
    ...(backlogWithoutExecutor
      ? [
          `queued_tasks_have_no_executable_worker: queueDepth=${queueDepth} activeJobs=${activeJobs} activeWorkers=0 activeWorkflowRuns=0`,
        ]
      : []),
  ];

  // Fail closed: never advertise worker/runtime readiness when backlog cannot execute.
  const workerReady = Boolean(marketplace.workerReady) && !backlogWithoutExecutor;
  const a2aRuntimeReady = Boolean(marketplace.a2aRuntimeReady) && !backlogWithoutExecutor;
  const workerCapacityReady =
    marketplace.workerCapacityReady !== false && !backlogWithoutExecutor;
  const workflowReady = marketplace.workflowReady !== false && !backlogWithoutExecutor;
  const overallReady =
    workerReady &&
    a2aRuntimeReady &&
    workerCapacityReady &&
    workflowReady &&
    degradedReasons.length === 0;

  return {
    ok: overallReady,
    service: "RepoDiet OKX Commerce Gateway",
    operator: buildOperatorProfile(),
    entitlementMode: resolveEntitlementMode(),
    a2mcpPaidMode: isOkxPaidMode(),
    overallReady,
    executionPathAvailable: !backlogWithoutExecutor && workerReady,
    paymentEnvironment: {
      environment: paymentEnv.environment,
      paymentMode: paymentEnv.paymentMode,
      network: paymentEnv.network,
      chainId: paymentEnv.chainId,
      asset: paymentEnv.asset,
      isTestnet: paymentEnv.isTestnet,
      isMainnet: paymentEnv.isMainnet,
      mainnetBlocked: paymentEnv.mainnetBlocked,
      blockReason: paymentEnv.blockReason ?? null,
    },
    ...marketplace,
    agentRuntime: {
      agentOnline: agentRuntime.agentOnline,
      onchainOsAuthenticated: agentRuntime.onchainOsAuthenticated,
      lastTaskReceivedAt: agentRuntime.lastTaskReceivedAt,
      lastAcknowledgementAt: agentRuntime.lastAcknowledgementAt,
      queueDepth: agentRuntime.queueDepth,
      oldestUnacknowledgedTaskAgeSeconds: agentRuntime.oldestUnacknowledgedTaskAgeSeconds,
      failedTaskCount: agentRuntime.failedTaskCount,
      // Do not claim model/delivery health from static defaults.
      modelProviderAvailable: null,
      a2mcpEndpointHealthy: agentRuntime.a2mcpEndpointHealthy,
      deliveryWorkerHealthy: null,
      alertAgentCannotAnswer: agentRuntime.alertAgentCannotAnswer,
      lastSeenAt: agentRuntime.lastSeenAt,
    },
    silentTimeoutPossible: backlogWithoutExecutor,
    immediateTaskAcknowledgment: true,
    configurationReady: Boolean(marketplace.configurationReady),
    queueReady: Boolean(marketplace.queueReady ?? marketplace.deepScanQueueReady),
    workerCapacityReady,
    workflowReady,
    a2aRuntimeReady,
    degradedReasons,
    // Public redacted readiness contract (overrides raw marketplace fields).
    workerReady,
    workerHeartbeatAgeSeconds: heartbeatAgeSeconds,
    workerHeartbeatAgeMs: marketplace.workerHeartbeatAgeMs,
    activeWorkers: marketplace.activeWorkers,
    workerVersion: marketplace.workerVersion ?? null,
    queueDepth: marketplace.queueDepth ?? 0,
    activeJobs: marketplace.activeJobs ?? 0,
    oldestQueuedTaskAgeSeconds: marketplace.oldestQueuedTaskAgeSeconds ?? 0,
    services: listOkxServices().map((s) => ({
      serviceId: s.serviceId,
      serviceType: s.serviceType,
      priceLabel: s.priceLabel,
      readOnly: s.readOnly,
      requiresEscrow: s.requiresEscrow,
    })),
    architecture: {
      a2mcp: "fixed-price x402 per call",
      a2a: "X Layer escrow + buyer approval",
      executionEngine: "shared — website, A2MCP, A2A use same engine",
      doubleChargePolicy: "A2A internal execution never pays A2MCP tools",
      worker: "ephemeral GitHub Actions on-demand analysis workers (free for public repos)",
      workerMode: marketplace.workerMode ?? "github_actions_on_demand",
      dispatcherReady: Boolean(marketplace.dispatcherReady),
      activeWorkflowRuns: marketplace.activeWorkflowRuns ?? 0,
      lastSuccessfulWorkerRun: marketplace.lastSuccessfulWorkerRun ?? null,
    },
    workerMode: marketplace.workerMode ?? "github_actions_on_demand",
    dispatcherReady: Boolean(marketplace.dispatcherReady),
    dispatcherReadyReason: marketplace.dispatcherReadyReason ?? null,
    dispatcherReadyMessage: marketplace.dispatcherReadyMessage ?? null,
    activeWorkflowRuns: marketplace.activeWorkflowRuns ?? 0,
    lastSuccessfulWorkerRun: marketplace.lastSuccessfulWorkerRun ?? null,
    recentDispatchSuccessRate: marketplace.recentDispatchSuccessRate ?? null,
    recentWorkerFailureRate: marketplace.recentWorkerFailureRate ?? null,
    deliveryReadiness: {
      githubApp: marketplace.githubAppReadyReasons ?? [],
      receiptSigner: marketplace.receiptSignerReadyReasons ?? [],
      attestationSigner: marketplace.attestationSignerReadyReasons ?? [],
      checkedAt: marketplace.updatedAt,
    },
    staleQueueReconciliation: staleQueueReport
      ? {
          checkedAt: staleQueueReport.checkedAt,
          queueDepthBefore: staleQueueReport.queueDepthBefore,
          queueDepthAfter: staleQueueReport.queueDepthAfter,
          activeJobsBefore: staleQueueReport.activeJobsBefore,
          activeJobsAfter: staleQueueReport.activeJobsAfter,
          staleJobsReconciled: staleQueueReport.staleJobsReconciled,
          completedEvidencePreserved: staleQueueReport.completedEvidencePreserved,
          inspections: staleQueueReport.inspections.map((row) => ({
            jobId: row.jobId,
            repository: row.repository,
            tenantOrOwner: row.tenantOrOwner,
            taskType: row.taskType,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            lastActivityAt: row.lastActivityAt,
            currentStage: row.currentStage,
            workflowRunId: row.workflowRunId,
            workflowRunExists: row.workflowRunExists,
            leaseStatus: row.leaseStatus,
            belongsToCompletedScan: row.belongsToCompletedScan,
            legacyIncidentJob: row.legacyIncidentJob,
            safeRecommendedTransition: row.safeRecommendedTransition,
            transitionApplied: row.transitionApplied,
            reason: row.reason,
          })),
        }
      : null,
    timestamp: new Date().toISOString(),
  };
}
