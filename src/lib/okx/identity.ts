import { getPaymentEnvironment } from "@/lib/payment/payment-environment";

const DEFAULT_IDENTITY = {
  appUrl: "https://skillswap-virid-kappa.vercel.app",
  aspAgentId: 5283,
  a2aServiceId: 32947,
  a2mcpServiceId: 32948,
  sellerWallet: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
  buyerWallet: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
  network: "eip155:196",
  settlementAsset: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
} as const;

export interface CanonicalOkxIdentity {
  appUrl: string;
  aspAgentId: number;
  a2aServiceId: number;
  a2mcpServiceId: number;
  sellerWallet: string;
  buyerWallet: string;
  network: string;
  settlementAsset: string;
  paymentMode?: "testnet" | "mainnet" | "unset";
  chainId?: number | null;
  environment?: "testnet" | "mainnet" | "unset";
  /** Present when Production was misconfigured with testnet payment mode. */
  productionTestnetMisconfig?: boolean;
  identityConflictDuringBuild?: boolean;
  /** Soft-resolved alias conflicts (Preview / build). Empty when strict agreement. */
  identityConflicts?: string[];
}

/** Next.js sets this only while compiling the production bundle. */
export function isNextProductionBuild(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

function configuredValues(names: string[]): Array<{ name: string; value: string }> {
  return names.flatMap((name) => {
    const value = process.env[name]?.trim();
    return value ? [{ name, value }] : [];
  });
}

function consistentValue(
  names: string[],
  fallback: string,
  normalize = (value: string) => value,
  conflictSink?: string[]
) {
  const configured = configuredValues(names);
  const normalized = configured.map(({ name, value }) => ({ name, value: normalize(value) }));
  const distinct = [...new Set(normalized.map(({ value }) => value))];
  if (distinct.length > 1) {
    const conflict = `okx_identity_conflict:${normalized.map(({ name }) => name).join(",")}`;
    conflictSink?.push(conflict);
    // During `next build`, and on Preview (where owners often dual-scope vars),
    // prefer the first declared alias instead of aborting every route with HTTP 500.
    // Production runtime stays strict unless REPODIET_SOFT_OKX_IDENTITY=1.
    const soft =
      isNextProductionBuild() ||
      process.env.REPODIET_SOFT_OKX_IDENTITY === "1" ||
      (process.env.VERCEL_ENV || "").toLowerCase() === "preview";
    if (soft) {
      return normalized[0]!.value;
    }
    throw new Error(conflict);
  }
  return distinct[0] ?? normalize(fallback);
}

function positiveInteger(value: string, label: string): number {
  if (!/^\d+$/.test(value) || Number(value) <= 0 || !Number.isSafeInteger(Number(value))) {
    if (isNextProductionBuild()) {
      if (label === "asp_agent_id") return DEFAULT_IDENTITY.aspAgentId;
      if (label === "a2a_service_id") return DEFAULT_IDENTITY.a2aServiceId;
      if (label === "a2mcp_service_id") return DEFAULT_IDENTITY.a2mcpServiceId;
      return 0;
    }
    throw new Error(`invalid_okx_identity:${label}`);
  }
  return Number(value);
}

function address(value: string, label: string): string {
  const normalized = value.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) {
    if (isNextProductionBuild()) {
      if (label === "seller_wallet") return DEFAULT_IDENTITY.sellerWallet;
      if (label === "buyer_wallet") return DEFAULT_IDENTITY.buyerWallet;
      if (label === "settlement_asset") return DEFAULT_IDENTITY.settlementAsset;
      return DEFAULT_IDENTITY.sellerWallet;
    }
    throw new Error(`invalid_okx_identity:${label}`);
  }
  return normalized;
}

function appUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") throw new Error("invalid_okx_identity:app_url");
    return parsed.origin;
  } catch {
    if (isNextProductionBuild()) return DEFAULT_IDENTITY.appUrl;
    throw new Error("invalid_okx_identity:app_url");
  }
}

export function getCanonicalOkxIdentity(): CanonicalOkxIdentity {
  const payment = getPaymentEnvironment();
  const identityConflicts: string[] = [];
  const aspAgentId = consistentValue(
    ["OKX_ASP_AGENT_ID", "REPODIET_OKX_AGENT_ID", "OKX_AGENT_ID", "NEXT_PUBLIC_OKX_ASP_AGENT_ID"],
    String(DEFAULT_IDENTITY.aspAgentId),
    (v) => v,
    identityConflicts
  );
  const a2aServiceId = consistentValue(
    ["OKX_A2A_SERVICE_ID", "REPODIET_OKX_A2A_SERVICE_ID", "NEXT_PUBLIC_OKX_A2A_SERVICE_ID"],
    String(DEFAULT_IDENTITY.a2aServiceId),
    (v) => v,
    identityConflicts
  );
  const a2mcpServiceId = consistentValue(
    ["OKX_A2MCP_SERVICE_ID", "REPODIET_OKX_A2MCP_SERVICE_ID", "NEXT_PUBLIC_OKX_A2MCP_SERVICE_ID"],
    String(DEFAULT_IDENTITY.a2mcpServiceId),
    (v) => v,
    identityConflicts
  );

  // When payment mode is explicitly set, prefer payment-environment resolution.
  // On Production, testnet mode is a misconfiguration — bind mainnet defaults for
  // compile-time constants, and surface productionTestnetMisconfig for fail-closed payments.
  const productionTestnetMisconfig = Boolean(payment.productionTestnetMisconfig);
  const network =
    productionTestnetMisconfig
      ? DEFAULT_IDENTITY.network
      : payment.paymentMode === "testnet" || payment.paymentMode === "mainnet"
        ? payment.network
        : consistentValue(
            ["REPODIET_X402_NETWORK", "REPODIET_PAYMENT_NETWORK"],
            DEFAULT_IDENTITY.network,
            (v) => v,
            identityConflicts
          );
  const settlementAsset =
    productionTestnetMisconfig
      ? DEFAULT_IDENTITY.settlementAsset
      : payment.paymentMode === "testnet" || payment.paymentMode === "mainnet"
        ? payment.asset
        : consistentValue(
            ["REPODIET_X402_ASSET", "REPODIET_PAYMENT_ASSET"],
            DEFAULT_IDENTITY.settlementAsset,
            (value) => address(value, "settlement_asset"),
            identityConflicts
          );

  return {
    appUrl: consistentValue(
      ["NEXT_PUBLIC_APP_URL", "REPODIET_APP_URL"],
      DEFAULT_IDENTITY.appUrl,
      appUrl,
      identityConflicts
    ),
    aspAgentId: positiveInteger(aspAgentId, "asp_agent_id"),
    a2aServiceId: positiveInteger(a2aServiceId, "a2a_service_id"),
    a2mcpServiceId: positiveInteger(a2mcpServiceId, "a2mcp_service_id"),
    sellerWallet: consistentValue(
      ["OKX_AGENTIC_WALLET_ADDRESS", "PAY_TO_ADDRESS", "REPODIET_PAY_TO"],
      DEFAULT_IDENTITY.sellerWallet,
      (value) => address(value, "seller_wallet"),
      identityConflicts
    ),
    buyerWallet: consistentValue(
      ["NEXT_PUBLIC_REPODIET_OWNER_BUYER_WALLET"],
      DEFAULT_IDENTITY.buyerWallet,
      (value) => address(value, "buyer_wallet"),
      identityConflicts
    ),
    network,
    settlementAsset,
    paymentMode: productionTestnetMisconfig ? "unset" : payment.paymentMode,
    chainId: productionTestnetMisconfig ? 196 : payment.chainId,
    environment: productionTestnetMisconfig ? "unset" : payment.environment,
    productionTestnetMisconfig,
    identityConflictDuringBuild: isNextProductionBuild() || undefined,
    identityConflicts: identityConflicts.length ? identityConflicts : undefined,
  };
}

export { DEFAULT_IDENTITY };
