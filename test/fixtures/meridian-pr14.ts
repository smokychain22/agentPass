/** Meridian src/lib/feed-curation.ts before RepoDiet PR #14 (commit 824075a). */
export const MERIDIAN_FEED_CURATION_GOOD = `/**
 * Curate live feed vs alpha scan — hide blue chips, favor movers & discovery names.
 */

import type { TrendingToken } from "./dexscreener";

const BLUE_CHIP_SYMBOLS = new Set([
  "weth",
  "eth",
  "ether",
  "wbtc",
  "btc",
  "cbbtc",
  "sol",
  "wsol",
  "arb",
  "bnb",
  "matic",
  "pol",
  "link",
  "uni",
  "aave",
  "dai",
  "usdc",
  "usdt",
  "op",
  "avax",
  "doge",
  "xrp",
  "ada",
  "trx",
  "ton",
  "pepe",
  "shib",
]);

const BLUE_CHIP_NAME_HINTS = [
  "wrapped ether",
  "wrapped bitcoin",
  "coinbase wrapped",
];

export function tokenKey(t: { chainId: string; tokenAddress: string }): string {
  return \`\${t.chainId}:\${t.tokenAddress.toLowerCase()}\`;
}
`;

/** Meridian src/lib/feed-curation.ts after broken RepoDiet PR #14 (commit a39937b). */
export const MERIDIAN_FEED_CURATION_BROKEN = `/**
 * Curate live feed vs alpha scan — hide blue chips, favor movers & discovery names.
 */

import type { TrendingToken } from "./dexscreener";

const BLUE_CHIP_NAME_HINTS = [

export function tokenKey(t: { chainId: string; tokenAddress: string }): string {
  return \`\${t.chainId}:\${t.tokenAddress.toLowerCase()}\`;
}
`;

/** Meridian src/lib/token-quote.ts before RepoDiet PR #14. */
export const MERIDIAN_TOKEN_QUOTE_GOOD = `/** Dex-backed quote is usable for agent copy (avoids $0.00 / empty-pool guidance). */
export function isTokenQuoteReliable(token: {
  priceUsd?: number;
  liquidityUsd?: number;
  pairAddress?: string | null;
}): boolean {
  const price = token.priceUsd ?? 0;
  const liq = token.liquidityUsd ?? 0;
  if (price <= 0 || liq < 500) return false;
  if (!token.pairAddress) return false;
  return true;
}
`;

/** Meridian src/lib/token-quote.ts after broken RepoDiet PR #14. */
export const MERIDIAN_TOKEN_QUOTE_BROKEN = `
  liquidityUsd?: number;
  pairAddress?: string | null;
}): boolean {
  const price = token.priceUsd ?? 0;
  const liq = token.liquidityUsd ?? 0;
  if (price <= 0 || liq < 500) return false;
  if (!token.pairAddress) return false;
  return true;
}
`;
