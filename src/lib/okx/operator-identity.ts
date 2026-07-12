import { OPERATOR_ID, RECEIPT_VERSION, X402_NETWORK, X402_RECIPIENT } from "@/lib/payment/constants";
import { aspAgentId, a2aServiceId, a2mcpServiceId } from "@/lib/okx/env-config";

export function getOperatorAgentId(): string {
  return aspAgentId() || OPERATOR_ID;
}

export function getOperatorWallet(): string {
  return X402_RECIPIENT;
}

export function getOperatorNetwork(): string {
  return X402_NETWORK;
}

export function getReceiptVersion(): string {
  return RECEIPT_VERSION;
}

export function buildOperatorProfile() {
  return {
    agentId: getOperatorAgentId(),
    name: "RepoDiet",
    description:
      "Hybrid OKX Agent Service Provider — A2MCP repository intelligence tools and A2A verified cleanup outcomes.",
    wallet: getOperatorWallet(),
    network: getOperatorNetwork(),
    serviceTypes: ["A2MCP", "A2A"],
    receiptVersion: getReceiptVersion(),
    aspRegistration: aspAgentId() ? "registered" : "pending_onchain_os",
    a2aServiceId: a2aServiceId(),
    a2mcpServiceId: a2mcpServiceId(),
  };
}
