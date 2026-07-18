/** Client-safe OKX identity — service IDs only (no seller wallet). */

export interface PublicOkxIdentity {
  aspAgentId: number;
  a2aServiceId: number;
  a2mcpServiceId: number;
}

export function getCanonicalOkxIdentityPublic(): PublicOkxIdentity {
  const asp = Number(
    process.env.NEXT_PUBLIC_OKX_ASP_AGENT_ID ||
      process.env.NEXT_PUBLIC_OKX_AGENT_ID ||
      "5283"
  );
  const a2a = Number(
    process.env.NEXT_PUBLIC_OKX_A2A_SERVICE_ID || "32947"
  );
  const a2mcp = Number(
    process.env.NEXT_PUBLIC_OKX_A2MCP_SERVICE_ID || "32948"
  );
  return {
    aspAgentId: Number.isFinite(asp) && asp > 0 ? asp : 5283,
    a2aServiceId: Number.isFinite(a2a) && a2a > 0 ? a2a : 32947,
    a2mcpServiceId: Number.isFinite(a2mcp) && a2mcp > 0 ? a2mcp : 32948,
  };
}
