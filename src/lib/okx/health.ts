import { resolveEntitlementMode } from "@/lib/entitlement/service";
import { getLastStaleQueueReconciliationReport } from "@/lib/deep-scan/reconcile-stale";
import { isOkxPaidMode } from "./entitlement";
import { buildOperatorProfile } from "./operator-identity";
import { listOkxServices } from "./services";
import { getMarketplaceHealthSnapshot } from "./marketplace-telemetry";
import { getAgentRuntimeHealth } from "@/lib/a2a/agent-runtime-health";
import { getPaymentEnvironment } from "@/lib/payment/payment-environment";
import { getCanonicalOkxIdentity } from "@/lib/okx/identity";

export async function buildOkxHealthResponse() {
  const marketplace = await getMarketplaceHealthSnapshot();
  const agentRuntime = await getAgentRuntimeHealth();
  const staleQueueReport = await getLastStaleQueueReconciliationReport();
  const paymentEnv = getPaymentEnvironment();
  const identity = getCanonicalOkxIdentity();
  const heartbeatAgeSeconds =
    marketplace.workerHeartbeatAgeMs == null
      ? null
      : Math.max(0, Math.floor(marketplace.workerHeartbeatAgeMs / 1000));

  const configurationReady = Boolean(marketplace.configurationReady);
  const discoveryReady = Boolean(identity.aspAgentId && identity.a2mcpServiceId);
  const unpaidChallengeHealthy =
    paymentEnv.mainnetBlocked !== true &&
    Boolean(paymentEnv.network && paymentEnv.asset && paymentEnv.sellerWallet);
  const paymentVerificationReady = Boolean(marketplace.paymentVerifierReady);
  const workerReady = Boolean(marketplace.workerReady);
  const signerReady = Boolean(marketplace.receiptSignerReady);
  const githubDeliveryReady = Boolean(marketplace.githubAppReady);
  const lastPaidCallAt = marketplace.a2mcpLastSuccessfulPaidCall;
  const lastPaidCallStatus = lastPaidCallAt ? "succeeded" : "never";

  // Endpoint is healthy for unpaid 402 challenges even when no customer has paid yet.
  const a2mcpEndpointHealthy =
    unpaidChallengeHealthy && configurationReady && discoveryReady;

  const degradedReasons = [
    ...(marketplace.degradedReasons ?? []),
    ...(!unpaidChallengeHealthy ? ["payment_challenge_config_incomplete"] : []),
    ...(!paymentVerificationReady ? ["payment_verification_not_ready"] : []),
    ...(!workerReady ? ["worker_not_ready"] : []),
    ...(!signerReady ? ["receipt_signer_not_ready"] : []),
    ...(!githubDeliveryReady ? ["github_delivery_not_ready"] : []),
  ];

  const overallReady =
    a2mcpEndpointHealthy &&
    paymentVerificationReady &&
    workerReady &&
    signerReady &&
    degradedReasons.length === 0;

  return {
    ok: true,
    service: "RepoDiet OKX Commerce Gateway",
    operator: buildOperatorProfile(),
    entitlementMode: resolveEntitlementMode(),
    a2mcpPaidMode: isOkxPaidMode(),
    application: {
      version: process.env.npm_package_version ?? "1.0.0",
      commit:
        process.env.VERCEL_GIT_COMMIT_SHA ||
        process.env.GIT_COMMIT_SHA ||
        process.env.COMMIT_SHA ||
        null,
    },
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
    configurationReady,
    discoveryReady,
    unpaidChallengeHealthy,
    paymentVerificationReady,
    workerReady,
    signerReady,
    githubDeliveryReady,
    lastPaidCallAt,
    lastPaidCallStatus,
    lastA2ATaskAt: agentRuntime.lastTaskReceivedAt,
    lastSuccessfulA2ADeliveryAt: marketplace.lastSuccessfulWorkerRun ?? null,
    a2mcpLastSuccessfulPaidCall: lastPaidCallAt,
    a2mcpEndpointHealthy,
    overallReady,
    degradedReasons,
    ...marketplace,
    agentRuntime: {
      agentOnline: agentRuntime.agentOnline,
      onchainOsAuthenticated: agentRuntime.onchainOsAuthenticated,
      lastTaskReceivedAt: agentRuntime.lastTaskReceivedAt,
      lastAcknowledgementAt: agentRuntime.lastAcknowledgementAt,
      queueDepth: agentRuntime.queueDepth,
      oldestUnacknowledgedTaskAgeSeconds: agentRuntime.oldestUnacknowledgedTaskAgeSeconds,
      failedTaskCount: agentRuntime.failedTaskCount,
      modelProviderAvailable: null,
      a2mcpEndpointHealthy,
      deliveryWorkerHealthy: null,
      alertAgentCannotAnswer: agentRuntime.alertAgentCannotAnswer,
      lastSeenAt: agentRuntime.lastSeenAt,
    },
    silentTimeoutPossible: false,
    immediateTaskAcknowledgment: true,
    queueReady: Boolean(marketplace.queueReady ?? marketplace.deepScanQueueReady),
    workerCapacityReady: marketplace.workerCapacityReady !== false,
    workflowReady: marketplace.workflowReady !== false,
    a2aRuntimeReady: Boolean(marketplace.a2aRuntimeReady),
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
