import {
  isXLayerChainId,
  XLAYER_ADD_CHAIN_PARAMS,
  XLAYER_CAIP2,
  XLAYER_EVM_CHAIN_ID,
} from "./chain-config";
import type { EIP1193Provider, WalletSession } from "./types";
import { WALLET_REQUEST_TIMEOUT_MS, withTimeout } from "./with-timeout";

export function getInjectedProvider(): EIP1193Provider | null {
  if (typeof window === "undefined") return null;
  const eth = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
  return eth ?? null;
}

async function providerRequest(
  provider: EIP1193Provider,
  args: { method: string; params?: unknown[] | Record<string, unknown> },
  timeoutMessage: string
): Promise<unknown> {
  return withTimeout(
    provider.request(args),
    WALLET_REQUEST_TIMEOUT_MS,
    timeoutMessage
  );
}

export async function connectInjectedWallet(): Promise<WalletSession> {
  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error("No wallet detected. Install MetaMask or another Web3 wallet.");
  }

  const accounts = (await providerRequest(
    provider,
    { method: "eth_requestAccounts" },
    "Wallet connection timed out. Open your wallet extension, approve or reject the request, then try again."
  )) as string[];

  const address = accounts[0]?.trim();
  if (!address) {
    throw new Error("Wallet connection was rejected.");
  }

  const chainIdHex = (await providerRequest(
    provider,
    { method: "eth_chainId" },
    "Could not read wallet network. Try again."
  )) as string;
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
    await providerRequest(
      provider,
      {
        method: "wallet_switchEthereumChain",
        params: [{ chainId: XLAYER_ADD_CHAIN_PARAMS.chainId }],
      },
      "Network switch timed out. Approve or reject the request in your wallet, then try again."
    );
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code === 4902) {
      await providerRequest(
        provider,
        {
          method: "wallet_addEthereumChain",
          params: [XLAYER_ADD_CHAIN_PARAMS],
        },
        "Adding X Layer timed out. Approve or reject the request in your wallet, then try again."
      );
    } else if (err instanceof Error && /timed out/i.test(err.message)) {
      throw err;
    } else {
      throw err instanceof Error ? err : new Error("Network switch rejected.");
    }
  }

  const accounts = (await providerRequest(
    provider,
    { method: "eth_accounts" },
    "Could not confirm wallet after network switch."
  )) as string[];
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

  try {
    const accounts = (await providerRequest(
      provider,
      { method: "eth_accounts" },
      "Wallet status check timed out."
    )) as string[];
    const address = accounts[0]?.trim();
    if (!address) return null;

    const chainIdHex = (await providerRequest(
      provider,
      { method: "eth_chainId" },
      "Wallet network check timed out."
    )) as string;
    const chainId = parseInt(chainIdHex, 16);

    return {
      address,
      chainId,
      caip2: isXLayerChainId(chainId) ? XLAYER_CAIP2 : `eip155:${chainId}`,
    };
  } catch {
    return null;
  }
}

/** USDT balance (atomic micro units) for the connected account on the current chain. */
export async function readErc20BalanceMicro(input: {
  owner: string;
  tokenAddress: string;
}): Promise<bigint> {
  const provider = getInjectedProvider();
  if (!provider) throw new Error("No wallet detected.");

  const owner = input.owner.trim().toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const data = `0x70a08231${owner}`;
  const result = (await providerRequest(
    provider,
    {
      method: "eth_call",
      params: [{ to: input.tokenAddress, data }, "latest"],
    },
    "Could not read USDT balance. Try again."
  )) as string;

  return BigInt(result || "0x0");
}
