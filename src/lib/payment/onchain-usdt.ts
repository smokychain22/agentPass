import { X402_ASSET, X402_NETWORK } from "@/lib/payment/constants";
import { resolveXLayerRpcUrl } from "@/lib/wallet/chain-config";
import { isLikelyTxHash, normalizeHexAddress } from "@/lib/wallet/erc20-transfer";

/** ERC-20 Transfer(address,address,uint256) topic */
export const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export interface OnchainUsdtVerificationInput {
  txHash: string;
  payer: string;
  recipient: string;
  amountMicro: string;
  tokenAddress?: string;
  network?: string;
  rpcUrl?: string;
}

export interface OnchainUsdtVerificationResult {
  ok: boolean;
  reason?: string;
  txHash?: string;
  blockNumber?: string;
  blockTimestampMs?: number;
  from?: string;
  to?: string;
  amountMicro?: string;
}

function xlayerRpcUrl(override?: string, network?: string): string {
  return resolveXLayerRpcUrl({ override, network });
}

function topicAddress(topic: string): string {
  return `0x${topic.slice(-40).toLowerCase()}`;
}

async function rpcCall<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`RPC ${method} failed with HTTP ${res.status}`);
  }
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) {
    throw new Error(json.error.message ?? `RPC ${method} error`);
  }
  return json.result as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReceipt(
  rpcUrl: string,
  txHash: string,
  attempts = 12
): Promise<{
  status?: string;
  blockNumber?: string;
  logs?: Array<{ address?: string; topics?: string[]; data?: string }>;
} | null> {
  for (let i = 0; i < attempts; i++) {
    const receipt = await rpcCall<{
      status?: string;
      blockNumber?: string;
      logs?: Array<{ address?: string; topics?: string[]; data?: string }>;
    } | null>(rpcUrl, "eth_getTransactionReceipt", [txHash]);
    if (receipt) return receipt;
    await sleep(1_500);
  }
  return null;
}

/**
 * Independently verify a mined USDT Transfer on X Layer matches quote terms.
 * Pure ERC-20 transfer path for direct website customers (not EIP-3009 / facilitator).
 */
export async function verifyOnchainUsdtTransfer(
  input: OnchainUsdtVerificationInput
): Promise<OnchainUsdtVerificationResult> {
  if (!isLikelyTxHash(input.txHash)) {
    return { ok: false, reason: "Payment reference must be a transaction hash (0x + 64 hex)." };
  }

  const network = input.network ?? X402_NETWORK;
  if (network !== X402_NETWORK) {
    return { ok: false, reason: `Wrong network. Expected ${X402_NETWORK}.` };
  }

  let payer: string;
  let recipient: string;
  let token: string;
  try {
    payer = normalizeHexAddress(input.payer);
    recipient = normalizeHexAddress(input.recipient);
    token = normalizeHexAddress(input.tokenAddress ?? X402_ASSET);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Invalid address." };
  }

  const expectedAmount = BigInt(input.amountMicro);
  const rpcUrl = xlayerRpcUrl(input.rpcUrl, network);

  let receipt: Awaited<ReturnType<typeof waitForReceipt>>;
  try {
    receipt = await waitForReceipt(rpcUrl, input.txHash.toLowerCase());
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "RPC verification failed.",
    };
  }

  if (!receipt) {
    return { ok: false, reason: "Transaction not found or not yet mined on X Layer." };
  }

  if (receipt.status && receipt.status !== "0x1") {
    return { ok: false, reason: "Transaction failed on-chain." };
  }

  const matching = (receipt.logs ?? []).find((log) => {
    if (!log.address || !log.topics || log.topics.length < 3 || !log.data) return false;
    if (log.address.toLowerCase() !== token) return false;
    if (log.topics[0]?.toLowerCase() !== ERC20_TRANSFER_TOPIC) return false;
    const from = topicAddress(log.topics[1]!);
    const to = topicAddress(log.topics[2]!);
    const amount = BigInt(log.data);
    return from === payer && to === recipient && amount === expectedAmount;
  });

  if (!matching) {
    return {
      ok: false,
      reason:
        "No matching USDT Transfer log for expected payer, recipient, token, and amount.",
    };
  }

  let blockTimestampMs: number | undefined;
  if (receipt.blockNumber) {
    try {
      const block = await rpcCall<{ timestamp?: string } | null>(
        rpcUrl,
        "eth_getBlockByNumber",
        [receipt.blockNumber, false]
      );
      if (block?.timestamp) {
        blockTimestampMs = Number(BigInt(block.timestamp) * BigInt(1000));
      }
    } catch (err) {
      return {
        ok: false,
        reason:
          err instanceof Error
            ? `Unable to verify payment block time: ${err.message}`
            : "Unable to verify payment block time.",
      };
    }
  }

  return {
    ok: true,
    txHash: input.txHash.toLowerCase(),
    blockNumber: receipt.blockNumber,
    blockTimestampMs,
    from: payer,
    to: recipient,
    amountMicro: input.amountMicro,
  };
}

const PAYMENT_BLOCK_CLOCK_SKEW_MS = 30_000;

/**
 * A transaction submitted after a quote expires is recoverable only when its
 * independently verified block time falls inside that original quote window.
 * The small lower-bound allowance covers block timestamp granularity and clock
 * skew. The transaction hash remains single-use through the payment store.
 */
export function isTransferTimestampWithinQuoteWindow(input: {
  blockTimestampMs: number;
  quoteCreatedAt: string;
  quoteExpiresAt: string;
}): boolean {
  if (!Number.isFinite(input.blockTimestampMs)) return false;
  const createdAtMs = Date.parse(input.quoteCreatedAt);
  const expiresAtMs = Date.parse(input.quoteExpiresAt);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiresAtMs)) return false;
  return (
    input.blockTimestampMs >= createdAtMs - PAYMENT_BLOCK_CLOCK_SKEW_MS &&
    input.blockTimestampMs <= expiresAtMs
  );
}

/** Match Transfer logs against expected fields — used by unit tests without RPC. */
export function matchUsdtTransferLog(input: {
  log: { address: string; topics: string[]; data: string };
  tokenAddress: string;
  payer: string;
  recipient: string;
  amountMicro: string;
}): boolean {
  const token = normalizeHexAddress(input.tokenAddress);
  const payer = normalizeHexAddress(input.payer);
  const recipient = normalizeHexAddress(input.recipient);
  if (input.log.address.toLowerCase() !== token) return false;
  if (input.log.topics[0]?.toLowerCase() !== ERC20_TRANSFER_TOPIC) return false;
  if (input.log.topics.length < 3) return false;
  if (topicAddress(input.log.topics[1]!) !== payer) return false;
  if (topicAddress(input.log.topics[2]!) !== recipient) return false;
  return BigInt(input.log.data) === BigInt(input.amountMicro);
}
