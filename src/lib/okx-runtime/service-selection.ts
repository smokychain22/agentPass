export const REPODIET_OKX_SERVICES = {
  a2a: {
    agentId: "5283",
    serviceId: "32947",
    serviceType: "A2A",
    operation: "create_cleanup_pr",
    sellerWallet: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
    communicationAddress: "0x185d96f1ccbae299263e789349028ef9569f9d22",
  },
  a2mcp: {
    agentId: "5283",
    serviceId: "32948",
    serviceType: "A2MCP",
    operation: "analyze_repository",
  },
} as const;

export type RepoDietProtocol = keyof typeof REPODIET_OKX_SERVICES;

export function requirePinnedService(input: {
  protocol: RepoDietProtocol;
  agentId: string;
  serviceId?: string;
  serviceType?: string;
}) {
  const expected = REPODIET_OKX_SERVICES[input.protocol];
  if (!input.serviceId) throw new Error("service_id_required");
  if (input.agentId !== expected.agentId) throw new Error("agent_id_mismatch");
  if (input.serviceId !== expected.serviceId) throw new Error("service_id_mismatch");
  if (input.serviceType !== expected.serviceType) throw new Error("service_type_mismatch");
  return expected;
}
