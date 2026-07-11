import { resolveEntitlementMode } from "@/lib/entitlement/service";
import { checkEntitlement } from "@/lib/entitlement/service";
import type { EntitlementResult } from "@/lib/entitlement/types";
import { isPaidA2mcpService } from "./services";

/** OKX-aware entitlement — A2MCP tools are paid when not in free beta. */
export function isOkxPaidMode(): boolean {
  const mode = resolveEntitlementMode();
  return (
    mode === "live_x402" ||
    mode === "test_payment" ||
    process.env.REPODIET_OKX_A2MCP_PAID === "1"
  );
}

export function checkOkxToolEntitlement(context: {
  toolKey: string;
  request?: Request;
  quoteId?: string;
}): EntitlementResult {
  if (!isPaidA2mcpService(context.toolKey)) {
    return checkEntitlement(context);
  }

  if (!isOkxPaidMode()) {
    return { allowed: true, mode: "free_beta", amountMicro: "0" };
  }

  if (context.quoteId) {
    return { allowed: true, mode: resolveEntitlementMode(), quoteId: context.quoteId };
  }

  return checkEntitlement({ ...context, toolKey: context.toolKey });
}
