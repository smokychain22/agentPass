/**
 * Canonical session origin for RepoDiet.
 * OKX sessions use escrow-only payment and marketplace delivery.
 */

export type SessionSource = "DIRECT_SITE" | "OKX_A2A" | "OKX_A2MCP";

export const SESSION_SOURCES: SessionSource[] = [
  "DIRECT_SITE",
  "OKX_A2A",
  "OKX_A2MCP",
];

export function isOkxSessionSource(source: SessionSource | null | undefined): boolean {
  return source === "OKX_A2A" || source === "OKX_A2MCP";
}

export function isOkxA2ASession(source: SessionSource | null | undefined): boolean {
  return source === "OKX_A2A";
}

/** Direct website payment is hidden for OKX-originated tasks. */
export function allowsDirectWebsitePayment(source: SessionSource | null | undefined): boolean {
  return !isOkxSessionSource(source);
}

export function parseSessionSource(raw: string | null | undefined): SessionSource {
  const value = (raw ?? "").trim().toUpperCase().replace(/-/g, "_");
  if (value === "OKX_A2A" || value === "OKX" || value === "A2A") return "OKX_A2A";
  if (value === "OKX_A2MCP" || value === "A2MCP") return "OKX_A2MCP";
  if (value === "DIRECT_SITE" || value === "DIRECT" || value === "WEBSITE") {
    return "DIRECT_SITE";
  }
  return "DIRECT_SITE";
}

export function resolveSessionSource(input: {
  querySource?: string | null;
  purchaseChannel?: "okx_marketplace" | "direct_site" | null;
  okxJobId?: string | null;
  okxTaskId?: string | null;
}): SessionSource {
  if (input.querySource) {
    const parsed = parseSessionSource(input.querySource);
    if (parsed !== "DIRECT_SITE" || /okx|a2a|a2mcp/i.test(input.querySource)) {
      return parsed;
    }
  }
  if (input.okxJobId || input.okxTaskId) return "OKX_A2A";
  if (input.purchaseChannel === "okx_marketplace") return "OKX_A2A";
  if (input.purchaseChannel === "direct_site") return "DIRECT_SITE";
  return "DIRECT_SITE";
}
