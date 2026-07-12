/** Resolve OKX / x402 env vars with official OKX naming aliases. */

export function readOkxEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function payToAddress(): string {
  return (
    readOkxEnv(
      "REPODIET_PAY_TO",
      "PAY_TO_ADDRESS",
      "OKX_AGENTIC_WALLET_ADDRESS"
    ) ?? "0xRepoDietTreasury00000000000000001"
  );
}

export function aspAgentId(): string | undefined {
  return readOkxEnv(
    "REPODIET_OKX_AGENT_ID",
    "OKX_ASP_AGENT_ID",
    "OKX_AGENT_ID",
    "NEXT_PUBLIC_OKX_ASP_AGENT_ID"
  );
}

export function a2aServiceId(): string | undefined {
  return readOkxEnv("OKX_A2A_SERVICE_ID", "REPODIET_OKX_A2A_SERVICE_ID");
}

export function a2mcpServiceId(): string | undefined {
  return readOkxEnv("OKX_A2MCP_SERVICE_ID", "REPODIET_OKX_A2MCP_SERVICE_ID");
}

export function okxApiCredentials(): {
  apiKey?: string;
  secretKey?: string;
  passphrase?: string;
} {
  return {
    apiKey: readOkxEnv("OKX_API_KEY", "REPODIET_OKX_API_KEY"),
    secretKey: readOkxEnv("OKX_SECRET_KEY", "REPODIET_OKX_SECRET_KEY"),
    passphrase: readOkxEnv("OKX_PASSPHRASE", "REPODIET_OKX_PASSPHRASE"),
  };
}

export function hasOkxPaymentSdkCredentials(): boolean {
  const { apiKey, secretKey, passphrase } = okxApiCredentials();
  return Boolean(apiKey && secretKey && passphrase);
}
