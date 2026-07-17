import { resolveEntitlementMode } from "@/lib/entitlement/service";
import { isOkxPaidMode } from "./entitlement";
import { buildOperatorProfile } from "./operator-identity";
import { listOkxServices } from "./services";
import { getMarketplaceHealthSnapshot } from "./marketplace-telemetry";

export async function buildOkxHealthResponse() {
  const marketplace = await getMarketplaceHealthSnapshot();
  const heartbeatAgeSeconds =
    marketplace.workerHeartbeatAgeMs == null
      ? null
      : Math.max(0, Math.floor(marketplace.workerHeartbeatAgeMs / 1000));
  return {
    ok: true,
    service: "RepoDiet OKX Commerce Gateway",
    operator: buildOperatorProfile(),
    entitlementMode: resolveEntitlementMode(),
    a2mcpPaidMode: isOkxPaidMode(),
    ...marketplace,
    // Public redacted readiness contract (overrides raw marketplace fields).
    workerReady: marketplace.workerReady,
    workerHeartbeatAgeSeconds: heartbeatAgeSeconds ?? 0,
    activeWorkers: marketplace.activeWorkers,
    workerVersion: marketplace.workerVersion ?? null,
    queueReady: Boolean(marketplace.deepScanQueueReady),
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
      worker: "always-on Linux worker claims durable deep-scan and cleanup jobs",
    },
    timestamp: new Date().toISOString(),
  };
}
