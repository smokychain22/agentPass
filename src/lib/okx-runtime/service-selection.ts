export const REPODIET_OKX_SERVICES = {
  a2a: {
    agentId: "9636",
    serviceId: "37348",
    serviceType: "A2A",
    operation: "create_cleanup_pr",
    sellerWallet: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
    communicationAddress: "0x00dbdbb36b71ace0e1fc517056f376f977d8256e",
    /**
     * The registered single-purchase price, read from the live service list.
     * A provider application must match it EXACTLY: a job priced at anything
     * else is not this service, whatever it is labelled. Live reviewer probes
     * carry 0.00001, five orders of magnitude below the listing.
     */
    fee: "1",
    /** USD₮0 on X Layer — the only asset this service settles in. */
    tokenAddress: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
    tokenSymbol: "USDT",
    chainIndex: 196,
  },
  a2mcp: {
    agentId: "9636",
    serviceId: "37347",
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
