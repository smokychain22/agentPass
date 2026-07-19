#!/usr/bin/env npx tsx
/**
 * Public read-only probe of buyer/seller testnet + mainnet balances.
 * Never prints private keys. Never submits transactions.
 */
import { writeFileSync } from "node:fs";

const BUYER = (
  process.env.NEXT_PUBLIC_REPODIET_OWNER_BUYER_WALLET ||
  "0xaa895234c3fc31c40018eef975db6ac79bf87f1a"
).toLowerCase();
const SELLER = (
  process.env.OKX_AGENTIC_WALLET_ADDRESS ||
  process.env.PAY_TO_ADDRESS ||
  "0x1339724ada3adf04bb7a8ccc6498216214bbdf90"
).toLowerCase();

const TESTNET_USDT = "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c";
const MAINNET_USDT = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
const TESTNET_RPCS = ["https://testrpc.xlayer.tech", "https://xlayertestrpc.okx.com"];
const MAINNET_RPCS = ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"];

const BALANCE_OF = "0x70a08231";

async function rpc(urls: string[], method: string, params: unknown[]): Promise<unknown> {
  let lastErr: unknown;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20_000),
      });
      const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (json.error) throw new Error(json.error.message || "rpc_error");
      return json.result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function padAddress(addr: string): string {
  return addr.replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

async function ethBalance(urls: string[], address: string): Promise<string> {
  const hex = (await rpc(urls, "eth_getBalance", [address, "latest"])) as string;
  const wei = BigInt(hex);
  return (Number(wei) / 1e18).toFixed(6);
}

async function erc20Balance(
  urls: string[],
  token: string,
  holder: string,
  decimals = 6
): Promise<string> {
  const data = `${BALANCE_OF}${padAddress(holder)}`;
  const hex = (await rpc(urls, "eth_call", [{ to: token, data }, "latest"])) as string;
  const raw = BigInt(hex || "0x0");
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = raw % base;
  return `${whole}.${frac.toString().padStart(decimals, "0")}`;
}

async function main() {
  const out = {
    buyerPublicAddress: BUYER,
    sellerPublicAddress: SELLER,
    buyerRoleEmail: "officialsmokychain@gmail.com",
    sellerRoleEmail: "abdullahlp114@gmail.com",
    testnet: {
      network: "eip155:1952",
      chainId: 1952,
      asset: TESTNET_USDT,
      buyerTestOkbBalance: await ethBalance(TESTNET_RPCS, BUYER),
      buyerTestUsdt0Balance: await erc20Balance(TESTNET_RPCS, TESTNET_USDT, BUYER),
      sellerTestUsdt0Balance: await erc20Balance(TESTNET_RPCS, TESTNET_USDT, SELLER),
    },
    mainnetReadOnly: {
      network: "eip155:196",
      chainId: 196,
      asset: MAINNET_USDT,
      note: "READ ONLY — do not authorize, transfer, or spend",
      buyerMainnetUsdt0Balance: await erc20Balance(MAINNET_RPCS, MAINNET_USDT, BUYER),
      sellerMainnetUsdt0Balance: await erc20Balance(MAINNET_RPCS, MAINNET_USDT, SELLER),
      buyerMainnetOkbBalance: await ethBalance(MAINNET_RPCS, BUYER),
    },
    probedAt: new Date().toISOString(),
  };

  const path =
    process.env.REPODIET_BALANCE_ARTIFACT ||
    "/opt/cursor/artifacts/testnet-wallet-balances.json";
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log(`wrote ${path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
