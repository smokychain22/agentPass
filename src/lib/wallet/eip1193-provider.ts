import {
  isXLayerChainId,
  XLAYER_ADD_CHAIN_PARAMS,
  XLAYER_CAIP2,
  XLAYER_EVM_CHAIN_ID,
} from "./chain-config";
import type { EIP1193Provider, WalletSession } from "./types";

export function getInjectedProvider(): EIP1193Provider | null {
  if (typeof window === "undefined") return null;
  const eth = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
  return eth ?? null;
}

export async function connectInjectedWallet(): Promise<WalletSession> {
  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error("No wallet detected. Install MetaMask or another Web3 wallet.");
  }

  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as string[];

  const address = accounts[0]?.trim();
  if (!address) {
    throw new Error("Wallet connection was rejected.");
  }

  const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
  const chainId = parseInt(chainIdHex, 16);

  return {
    address,
    chainId,
    caip2: isXLayerChainId(chainId) ? XLAYER_CAIP2 : `eip155:${chainId}`,
  };
}

export async function switchToXLayer(): Promise<WalletSession> {
  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error("No wallet detected.");
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: XLAYER_ADD_CHAIN_PARAMS.chainId }],
    });
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [XLAYER_ADD_CHAIN_PARAMS],
      });
    } else {
      throw err instanceof Error ? err : new Error("Network switch rejected.");
    }
  }

  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  const address = accounts[0];
  if (!address) throw new Error("Wallet not connected.");

  return {
    address,
    chainId: XLAYER_EVM_CHAIN_ID,
    caip2: XLAYER_CAIP2,
  };
}

export async function readConnectedSession(): Promise<WalletSession | null> {
  const provider = getInjectedProvider();
  if (!provider) return null;

  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  const address = accounts[0]?.trim();
  if (!address) return null;

  const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
  const chainId = parseInt(chainIdHex, 16);

  return {
    address,
    chainId,
    caip2: isXLayerChainId(chainId) ? XLAYER_CAIP2 : `eip155:${chainId}`,
  };
}
