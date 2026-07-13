import { aspAgentId, hasOkxPaymentSdkCredentials, payToAddress } from "@/lib/okx/env-config";

function isConfiguredPayTo(): boolean {
  const payTo = payToAddress();
  return Boolean(payTo && !payTo.startsWith("0xRepoDietTreasury"));
}

export function buildOkxReadinessResponse() {
  const developerApi = hasOkxPaymentSdkCredentials();
  const agenticWallet = isConfiguredPayTo();
  const aspId = aspAgentId();
  const realX402Required = process.env.REQUIRE_REAL_X402 === "1";
  const paidA2McpEnabled = process.env.REPODIET_OKX_A2MCP_PAID === "1";

  return {
    agenticWallet,
    developerApi,
    aspAgentId: Boolean(aspId),
    realX402Required,
    paidA2McpEnabled,
    payToConfigured: agenticWallet,
    aspAgentIdValue: aspId ?? null,
  };
}
