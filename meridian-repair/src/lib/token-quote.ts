
/** Dex-backed quote is usable for agent copy (avoids $0.00 / empty-pool guidance). */
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

export function unreliableQuoteMessage(symbol: string): string {
  return `${symbol}: live pool quote still syncing — expand Agent reasoning after Dex confirms price and liquidity (stats above update first).`;
}
