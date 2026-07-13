/** X Layer mainnet — single source of truth for direct-site payments. */
export const XLAYER_EVM_CHAIN_ID = 196;
export const XLAYER_CAIP2 = "eip155:196";
export const XLAYER_CHAIN_HEX = "0xc4";

export const XLAYER_NETWORK_LABEL = "X Layer";

export const XLAYER_ADD_CHAIN_PARAMS = {
  chainId: XLAYER_CHAIN_HEX,
  chainName: "X Layer Mainnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: ["https://rpc.xlayer.tech"],
  blockExplorerUrls: ["https://www.okx.com/explorer/xlayer"],
} as const;

export function isXLayerChainId(chainId: number | string | undefined): boolean {
  if (chainId === undefined) return false;
  const normalized =
    typeof chainId === "string"
      ? chainId.startsWith("0x")
        ? parseInt(chainId, 16)
        : Number(chainId)
      : chainId;
  return normalized === XLAYER_EVM_CHAIN_ID;
}

export function shortenAddress(address: string, chars = 4): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}
