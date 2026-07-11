import { resolveEntitlementMode } from "@/lib/entitlement/service";
import { isOkxPaidMode } from "./entitlement";
import { buildOperatorProfile } from "./operator-identity";
import { listOkxServices } from "./services";

export function buildOkxHealthResponse() {
  return {
    ok: true,
    service: "RepoDiet OKX Commerce Gateway",
    operator: buildOperatorProfile(),
    entitlementMode: resolveEntitlementMode(),
    a2mcpPaidMode: isOkxPaidMode(),
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
    },
    timestamp: new Date().toISOString(),
  };
}
