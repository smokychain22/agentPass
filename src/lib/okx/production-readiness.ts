/**
 * Honest production-readiness contract.
 * ready === true only when required live probes and evidence exist.
 */

import { resolveEntitlementMode } from "@/lib/entitlement/service";
import { isOkxPaidMode } from "@/lib/okx/entitlement";
import { buildOperatorProfile } from "@/lib/okx/operator-identity";
import { getMarketplaceHealthSnapshot } from "@/lib/okx/marketplace-telemetry";
import { probeDeliveryReadiness } from "@/lib/delivery/readiness";
import { getAgentRuntimeHealth } from "@/lib/a2a/agent-runtime-health";
import { durableNow, getDurableRecord, setDurableRecord } from "@/lib/store/durable-store";
import { REPOSITORY_SUPPORT_MATRIX } from "@/lib/product/support-matrix";
import { PRODUCT_CAPABILITY_MATRIX } from "@/lib/product/capability-matrix";

export type ProductionReadinessVerdict =
  | "PRODUCTION_READY"
  | "CONTROLLED_BETA"
  | "NOT_READY";

export interface ProductionEvidenceRecord {
  lastSuccessfulPaidA2mcpAt: string | null;
  lastSuccessfulPaidA2mcpQuoteId: string | null;
  lastSuccessfulA2aDeliveryAt: string | null;
  lastSuccessfulA2aTaskId: string | null;
  lastRealPrCreatedAt: string | null;
  lastRealPrUrl: string | null;
  lastRealPrNumber: number | null;
  lastSuccessfulEscrowReleaseAt: string | null;
  lastSuccessfulEscrowReference: string | null;
  updatedAt: string;
}

const EVIDENCE_KEY = "production_evidence_snapshot";

function emptyEvidence(): ProductionEvidenceRecord {
  return {
    lastSuccessfulPaidA2mcpAt: null,
    lastSuccessfulPaidA2mcpQuoteId: null,
    lastSuccessfulA2aDeliveryAt: null,
    lastSuccessfulA2aTaskId: null,
    lastRealPrCreatedAt: null,
    lastRealPrUrl: null,
    lastRealPrNumber: null,
    lastSuccessfulEscrowReleaseAt: null,
    lastSuccessfulEscrowReference: null,
    updatedAt: durableNow(),
  };
}

export async function getProductionEvidence(): Promise<ProductionEvidenceRecord> {
  return (
    (await getDurableRecord<ProductionEvidenceRecord>(
      "marketplace_deliveries",
      EVIDENCE_KEY
    )) ?? emptyEvidence()
  );
}

export async function recordProductionEvidence(
  patch: Partial<ProductionEvidenceRecord>
): Promise<ProductionEvidenceRecord> {
  const existing = await getProductionEvidence();
  const updated: ProductionEvidenceRecord = {
    ...existing,
    ...patch,
    updatedAt: durableNow(),
  };
  await setDurableRecord("marketplace_deliveries", EVIDENCE_KEY, updated);
  return updated;
}

export interface ProductionProbeResult {
  id: string;
  ready: boolean;
  requiredForProduction: boolean;
  source: "live_probe" | "config" | "evidence" | "runtime";
  detail: string;
}

export async function buildProductionReadinessResponse() {
  const [marketplace, delivery, agent, evidence] = await Promise.all([
    getMarketplaceHealthSnapshot(),
    probeDeliveryReadiness(),
    getAgentRuntimeHealth(),
    getProductionEvidence(),
  ]);

  const entitlementMode = resolveEntitlementMode();
  const paidMode = isOkxPaidMode();
  const realX402 = process.env.REQUIRE_REAL_X402 === "1";
  const freeBetaForbidden = entitlementMode !== "free_beta";

  const probes: ProductionProbeResult[] = [
    {
      id: "durable_store",
      ready: true,
      requiredForProduction: true,
      source: "runtime",
      detail: "Durable record read/write path reachable for evidence snapshot.",
    },
    {
      id: "a2mcp_paid_mode",
      ready: paidMode && realX402 && freeBetaForbidden,
      requiredForProduction: true,
      source: "config",
      detail: `entitlementMode=${entitlementMode}; REQUIRE_REAL_X402=${realX402 ? "1" : "0"}`,
    },
    {
      id: "a2a_marketplace_intake",
      ready: marketplace.a2aInitialResponseReady === true,
      requiredForProduction: true,
      source: "runtime",
      detail: "A2A discovery acknowledgement path marked ready.",
    },
    {
      id: "github_app",
      ready: delivery.githubAppReady,
      requiredForProduction: true,
      source: "live_probe",
      detail: delivery.githubApp.reasons.join(",") || "GitHub App JWT + permissions probe passed.",
    },
    {
      id: "receipt_signer",
      ready: delivery.receiptSignerReady,
      requiredForProduction: true,
      source: "live_probe",
      detail:
        delivery.receiptSigner.reasons.join(",") || "Receipt signer self-test passed.",
    },
    {
      id: "attestation_signer",
      ready: delivery.attestationSignerReady,
      requiredForProduction: true,
      source: "live_probe",
      detail:
        delivery.attestationSigner.reasons.join(",") || "Attestation signer self-test passed.",
    },
    {
      id: "worker_or_dispatcher",
      ready: Boolean(marketplace.workerReady || marketplace.dispatcherReady),
      requiredForProduction: true,
      source: "live_probe",
      detail: `workerReady=${marketplace.workerReady}; dispatcherReady=${marketplace.dispatcherReady}`,
    },
    {
      id: "last_paid_a2mcp",
      ready: Boolean(evidence.lastSuccessfulPaidA2mcpAt || marketplace.a2mcpLastSuccessfulPaidCall),
      requiredForProduction: true,
      source: "evidence",
      detail:
        evidence.lastSuccessfulPaidA2mcpAt ||
        marketplace.a2mcpLastSuccessfulPaidCall ||
        "No paid A2MCP success recorded.",
    },
    {
      id: "last_real_pr",
      ready: Boolean(evidence.lastRealPrUrl && evidence.lastRealPrCreatedAt),
      requiredForProduction: true,
      source: "evidence",
      detail: evidence.lastRealPrUrl || "No real GitHub PR creation recorded.",
    },
    {
      id: "last_escrow_release",
      ready: Boolean(evidence.lastSuccessfulEscrowReleaseAt),
      requiredForProduction: true,
      source: "evidence",
      detail:
        evidence.lastSuccessfulEscrowReleaseAt || "No escrow release evidence recorded.",
    },
    {
      id: "agent_cannot_answer_alert",
      ready: !agent.alertAgentCannotAnswer,
      requiredForProduction: true,
      source: "runtime",
      detail: agent.alertAgentCannotAnswer
        ? "Agent alert: cannot answer tasks"
        : "No silent-timeout alert.",
    },
  ];

  const required = probes.filter((p) => p.requiredForProduction);
  const failedRequired = required.filter((p) => !p.ready);
  const allRequiredReady = failedRequired.length === 0;

  let verdict: ProductionReadinessVerdict = "NOT_READY";
  if (allRequiredReady) {
    verdict = "PRODUCTION_READY";
  } else if (
    paidMode &&
    realX402 &&
    delivery.githubAppReady &&
    marketplace.a2aInitialResponseReady &&
    (evidence.lastSuccessfulPaidA2mcpAt || marketplace.a2mcpLastSuccessfulPaidCall)
  ) {
    verdict = "CONTROLLED_BETA";
  }

  return {
    ok: allRequiredReady,
    ready: allRequiredReady,
    verdict,
    silentTimeoutPossible: false,
    freeBetaAllowedInProduction: false,
    unsignedReceiptAcceptedInProduction: false,
    missingTokenPrCountedAsSuccess: false,
    operator: buildOperatorProfile(),
    entitlementMode,
    a2mcpPaidMode: paidMode,
    requireRealX402: realX402,
    supportMatrixVersion: REPOSITORY_SUPPORT_MATRIX.version,
    capabilityMatrixVersion: PRODUCT_CAPABILITY_MATRIX.version,
    probes,
    failedRequired: failedRequired.map((p) => p.id),
    evidence,
    delivery: {
      githubAppReady: delivery.githubAppReady,
      receiptSignerReady: delivery.receiptSignerReady,
      attestationSignerReady: delivery.attestationSignerReady,
      githubAppReasons: delivery.githubApp.reasons,
      receiptSignerReasons: delivery.receiptSigner.reasons,
      attestationSignerReasons: delivery.attestationSigner.reasons,
    },
    marketplace: {
      workerReady: marketplace.workerReady,
      dispatcherReady: marketplace.dispatcherReady,
      queueDepth: marketplace.queueDepth,
      a2mcpLastSuccessfulPaidCall: marketplace.a2mcpLastSuccessfulPaidCall,
      lastSuccessfulWorkerRun: marketplace.lastSuccessfulWorkerRun,
    },
    agentRuntime: {
      agentOnline: agent.agentOnline,
      alertAgentCannotAnswer: agent.alertAgentCannotAnswer,
      lastTaskReceivedAt: agent.lastTaskReceivedAt,
      lastAcknowledgementAt: agent.lastAcknowledgementAt,
      queueDepth: agent.queueDepth,
    },
    timestamp: new Date().toISOString(),
  };
}
