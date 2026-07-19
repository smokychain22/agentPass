/** X Layer mainnet — default for production direct-site payments. */
export const XLAYER_EVM_CHAIN_ID = 196;
export const XLAYER_CAIP2 = "eip155:196";
export const XLAYER_CHAIN_HEX = "0xc4";

/** X Layer testnet — used only when REPODIET_PAYMENT_MODE=testnet. */
export const XLAYER_TESTNET_EVM_CHAIN_ID = 1952;
export const XLAYER_TESTNET_CAIP2 = "eip155:1952";
export const XLAYER_TESTNET_CHAIN_HEX = "0x7a0";

export const XLAYER_NETWORK_LABEL = "X Layer";

export const XLAYER_ADD_CHAIN_PARAMS = {
  chainId: XLAYER_CHAIN_HEX,
  chainName: "X Layer Mainnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: ["https://rpc.xlayer.tech"],
  blockExplorerUrls: ["https://www.okx.com/explorer/xlayer"],
} as const;

export const XLAYER_TESTNET_ADD_CHAIN_PARAMS = {
  chainId: XLAYER_TESTNET_CHAIN_HEX,
  chainName: "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: ["https://testrpc.xlayer.tech", "https://xlayertestrpc.okx.com"],
  blockExplorerUrls: ["https://www.okx.com/explorer/xlayer-test"],
} as const;

export function isXLayerChainId(chainId: number | string | undefined): boolean {
  if (chainId === undefined) return false;
  const normalized =
    typeof chainId === "string"
      ? chainId.startsWith("0x")
        ? parseInt(chainId, 16)
        : Number(chainId)
      : chainId;
  return (
    normalized === XLAYER_EVM_CHAIN_ID || normalized === XLAYER_TESTNET_EVM_CHAIN_ID
  );
}

/** Resolve RPC for the active payment network (testnet Preview vs mainnet prod). */
export function resolveXLayerRpcUrl(options?: {
  network?: string;
  chainId?: number | null;
  override?: string;
}): string {
  if (options?.override?.trim()) return options.override.trim();
  if (process.env.XLAYER_RPC_URL?.trim()) return process.env.XLAYER_RPC_URL.trim();
  if (process.env.REPODIET_XLAYER_RPC_URL?.trim()) {
    return process.env.REPODIET_XLAYER_RPC_URL.trim();
  }
  const network = options?.network ?? "";
  const chainId = options?.chainId ?? null;
  if (network === XLAYER_TESTNET_CAIP2 || chainId === XLAYER_TESTNET_EVM_CHAIN_ID) {
    return XLAYER_TESTNET_ADD_CHAIN_PARAMS.rpcUrls[0];
  }
  return XLAYER_ADD_CHAIN_PARAMS.rpcUrls[0];
}

export function shortenAddress(address: string, chars = 4): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}
