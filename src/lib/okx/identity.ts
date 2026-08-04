import { getPaymentEnvironment } from "@/lib/payment/payment-environment";

const DEFAULT_IDENTITY = {
  appUrl: "https://skillswap-virid-kappa.vercel.app",
  aspAgentId: 9636,
  /**
   * The canonical production buyer — User Agent 10466.
   *
   * Previously there was no buyer agent id here at all, so every caller that
   * needed one fell back to its own literal, and the literal in
   * `api/a2a/preflight` was the historical Agent 5295. Defining it once, next
   * to the ASP it transacts with, is what stops a superseded identity from
   * reappearing as somebody's local default.
   */
  buyerAgentId: 10466,
  a2aServiceId: 37348,
  a2mcpServiceId: 37347,
  sellerWallet: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
  /**
   * The buyer's OWN wallet. This previously duplicated `sellerWallet`, which
   * is not merely cosmetic: `api/deep-scans` stamps `identity.buyerWallet`
   * onto the tenant record, so buyer-attributed rows carried the seller's
   * address and no buyer/seller distinction survived in that data.
   */
  buyerWallet: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
  network: "eip155:196",
  settlementAsset: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
} as const;

export interface CanonicalOkxIdentity {
  appUrl: string;
  aspAgentId: number;
  buyerAgentId: number;
  a2aServiceId: number;
  a2mcpServiceId: number;
  sellerWallet: string;
  buyerWallet: string;
  network: string;
  settlementAsset: string;
  paymentMode?: "testnet" | "mainnet" | "unset";
  chainId?: number | null;
  environment?: "testnet" | "mainnet" | "unset";
}

function configuredValues(names: string[]): Array<{ name: string; value: string }> {
  return names.flatMap((name) => {
    const value = process.env[name]?.trim();
    return value ? [{ name, value }] : [];
  });
}

function consistentValue(names: string[], fallback: string, normalize = (value: string) => value) {
  const configured = configuredValues(names);
  const normalized = configured.map(({ name, value }) => ({ name, value: normalize(value) }));
  const distinct = [...new Set(normalized.map(({ value }) => value))];
  if (distinct.length > 1) {
    throw new Error(`okx_identity_conflict:${normalized.map(({ name }) => name).join(",")}`);
  }
  return distinct[0] ?? normalize(fallback);
}

function positiveInteger(value: string, label: string): number {
  if (!/^\d+$/.test(value) || Number(value) <= 0 || !Number.isSafeInteger(Number(value))) {
    throw new Error(`invalid_okx_identity:${label}`);
  }
  return Number(value);
}

function address(value: string, label: string): string {
  const normalized = value.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) throw new Error(`invalid_okx_identity:${label}`);
  return normalized;
}

function appUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error("invalid_okx_identity:app_url");
  return parsed.origin;
}

export function getCanonicalOkxIdentity(): CanonicalOkxIdentity {
  const payment = getPaymentEnvironment();
  const aspAgentId = consistentValue(
    ["OKX_ASP_AGENT_ID", "REPODIET_OKX_AGENT_ID", "OKX_AGENT_ID", "NEXT_PUBLIC_OKX_ASP_AGENT_ID"],
    String(DEFAULT_IDENTITY.aspAgentId)
  );
  const a2aServiceId = consistentValue(
    ["OKX_A2A_SERVICE_ID", "REPODIET_OKX_A2A_SERVICE_ID", "NEXT_PUBLIC_OKX_A2A_SERVICE_ID"],
    String(DEFAULT_IDENTITY.a2aServiceId)
  );
  const a2mcpServiceId = consistentValue(
    ["OKX_A2MCP_SERVICE_ID", "REPODIET_OKX_A2MCP_SERVICE_ID", "NEXT_PUBLIC_OKX_A2MCP_SERVICE_ID"],
    String(DEFAULT_IDENTITY.a2mcpServiceId)
  );
  const buyerAgentId = consistentValue(
    ["REPODIET_OKX_BUYER_AGENT_ID", "OKX_BUYER_AGENT_ID"],
    String(DEFAULT_IDENTITY.buyerAgentId)
  );

  // When payment mode is explicitly testnet, prefer payment-environment resolution
  // (REPODIET_PAYMENT_*). Otherwise keep legacy REPODIET_X402_* / defaults.
  const network =
    payment.paymentMode === "testnet" || payment.paymentMode === "mainnet"
      ? payment.network
      : consistentValue(["REPODIET_X402_NETWORK", "REPODIET_PAYMENT_NETWORK"], DEFAULT_IDENTITY.network);
  const settlementAsset =
    payment.paymentMode === "testnet" || payment.paymentMode === "mainnet"
      ? payment.asset
      : consistentValue(
          ["REPODIET_X402_ASSET", "REPODIET_PAYMENT_ASSET"],
          DEFAULT_IDENTITY.settlementAsset,
          (value) => address(value, "settlement_asset")
        );

  return {
    appUrl: consistentValue(
      ["NEXT_PUBLIC_APP_URL", "REPODIET_APP_URL"],
      DEFAULT_IDENTITY.appUrl,
      appUrl
    ),
    aspAgentId: positiveInteger(aspAgentId, "asp_agent_id"),
    buyerAgentId: positiveInteger(buyerAgentId, "buyer_agent_id"),
    a2aServiceId: positiveInteger(a2aServiceId, "a2a_service_id"),
    a2mcpServiceId: positiveInteger(a2mcpServiceId, "a2mcp_service_id"),
    sellerWallet: consistentValue(
      ["OKX_AGENTIC_WALLET_ADDRESS", "PAY_TO_ADDRESS", "REPODIET_PAY_TO"],
      DEFAULT_IDENTITY.sellerWallet,
      (value) => address(value, "seller_wallet")
    ),
    buyerWallet: consistentValue(
      ["NEXT_PUBLIC_REPODIET_OWNER_BUYER_WALLET"],
      DEFAULT_IDENTITY.buyerWallet,
      (value) => address(value, "buyer_wallet")
    ),
    network,
    settlementAsset,
    paymentMode: payment.paymentMode,
    chainId: payment.chainId,
    environment: payment.environment,
  };
}

export { DEFAULT_IDENTITY };
