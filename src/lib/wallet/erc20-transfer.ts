import { X402_ASSET } from "@/lib/payment/constants";
import { XLAYER_EVM_CHAIN_ID } from "@/lib/wallet/chain-config";
import { getInjectedProvider } from "@/lib/wallet/eip1193-provider";
import { WALLET_REQUEST_TIMEOUT_MS, withTimeout } from "@/lib/wallet/with-timeout";

/** ERC-20 transfer(address,uint256) selector */
const TRANSFER_SELECTOR = "0xa9059cbb";

export function encodeErc20Transfer(to: string, amountMicro: string): string {
  const recipient = normalizeHexAddress(to);
  const amount = BigInt(amountMicro);
  if (amount < BigInt(0)) throw new Error("Payment amount must be non-negative.");

  const toWord = recipient.slice(2).toLowerCase().padStart(64, "0");
  const amountWord = amount.toString(16).padStart(64, "0");
  return `${TRANSFER_SELECTOR}${toWord}${amountWord}`;
}

export function normalizeHexAddress(address: string): string {
  const trimmed = address.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    throw new Error("Invalid EVM address.");
  }
  return trimmed.toLowerCase();
}

export function isLikelyTxHash(value: string | undefined): boolean {
  return Boolean(value && /^0x[a-fA-F0-9]{64}$/.test(value.trim()));
}

/**
 * Ask the connected injected wallet to send USDT on X Layer to the quote recipient.
 * Returns the transaction hash used as paymentReference.
 */
export async function sendUsdtPayment(input: {
  from: string;
  to: string;
  amountMicro: string;
  tokenAddress?: string;
  chainId?: number;
}): Promise<{ txHash: string }> {
  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error("No wallet detected. Connect an injected wallet first.");
  }

  const from = normalizeHexAddress(input.from);
  const to = normalizeHexAddress(input.to);
  const token = normalizeHexAddress(input.tokenAddress ?? X402_ASSET);
  const data = encodeErc20Transfer(to, input.amountMicro);

  const expectedChain = input.chainId ?? XLAYER_EVM_CHAIN_ID;
  const chainIdHex = (await withTimeout(
    provider.request({ method: "eth_chainId" }),
    WALLET_REQUEST_TIMEOUT_MS,
    "Could not read wallet network before payment."
  )) as string;
  const chainId = parseInt(chainIdHex, 16);
  if (chainId !== expectedChain) {
    throw new Error(`Wrong network. Switch to X Layer (chain ${expectedChain}).`);
  }

  const txHash = (await withTimeout(
    provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from,
          to: token,
          data,
          value: "0x0",
        },
      ],
    }),
    WALLET_REQUEST_TIMEOUT_MS,
    "Payment request timed out. Approve or reject the transfer in your wallet, then retry. If a transaction already appeared, do not send again — use Confirm submitted payment."
  )) as string;

  if (!isLikelyTxHash(txHash)) {
    throw new Error("Wallet did not return a valid transaction hash.");
  }

  return { txHash: txHash.toLowerCase() };
}
