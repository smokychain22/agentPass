import { DEFAULT_IDENTITY } from "@/lib/okx/identity";

/**
 * Resolve the public OKX.AI agent listing URL.
 * Never invent a URL when env is unset — listing may be private.
 */
export function resolveOkxAgentUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_OKX_AGENT_URL?.trim();
  if (configured) return configured;

  // Optional construction when ASP id is published AND an explicit opt-in is set.
  // Keeps marketplace path disabled by default per OKX listing privacy guidance.
  if (process.env.NEXT_PUBLIC_OKX_AGENT_URL_AUTO !== "1") return null;

  const agentId =
    process.env.NEXT_PUBLIC_OKX_ASP_AGENT_ID?.trim() ||
    process.env.OKX_ASP_AGENT_ID?.trim() ||
    String(DEFAULT_IDENTITY.aspAgentId);
  if (!agentId) return null;
  return `https://www.okx.ai/agents/${agentId}`;
}
