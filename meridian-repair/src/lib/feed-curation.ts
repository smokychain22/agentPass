/**
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
  "ethereum",
  "solana",
  "arbitrum",
  "chainlink",
  "uniswap",
];

export function tokenKey(t: { chainId: string; tokenAddress: string }): string {
  return `${t.chainId}:${t.tokenAddress.toLowerCase()}`;
}

export function symbolChainKey(t: { chainId: string; symbol: string }): string {
  return `${t.chainId}:${t.symbol.replace(/^\$/, "").trim().toUpperCase()}`;
}

/** One row per symbol per chain — keeps highest-volume pair (fixes duplicate SAOS / PEPE rows). */
export function dedupeFeedTokens<T extends TrendingToken>(tokens: T[]): T[] {
  const ranked = [...tokens].sort((a, b) => b.volume24h - a.volume24h);
  const bySymbol = new Map<string, T>();
  const byAddress = new Set<string>();

  for (const t of ranked) {
    const addr = tokenKey(t);
    if (byAddress.has(addr)) continue;
    const sym = symbolChainKey(t);
    if (bySymbol.has(sym)) continue;
    bySymbol.set(sym, t);
    byAddress.add(addr);
  }
  return [...bySymbol.values()];
}

export function isBlueChip(symbol: string, name?: string): boolean {
  const sym = symbol.replace(/^\$/, "").trim().toLowerCase();
  if (BLUE_CHIP_SYMBOLS.has(sym)) return true;
  if (/^w(eth|btc|sol)$/i.test(sym)) return true;
  const n = (name ?? "").toLowerCase();
  return BLUE_CHIP_NAME_HINTS.some((h) => n.includes(h));
}

function turnover(t: TrendingToken): number {
  return t.liquidityUsd > 0 ? t.volume24h / t.liquidityUsd : 0;
}

function buyPressure(t: TrendingToken): number {
  const b = t.txns24h?.buys ?? 0;
  const s = t.txns24h?.sells ?? 1;
  return b / Math.max(s, 1);
}

function isFeedExcluded(t: TrendingToken): boolean {
  return (
    isStablecoin(t.symbol, t.name, {
      tokenAddress: t.tokenAddress,
      chainId: t.chainId,
      priceUsd: t.priceUsd,
      change24h: t.change24h,
    }) || isBlueChip(t.symbol, t.name)
  );
}

/** Live feed: tradable alts with real movement (not mega-cap wrappers). */
export function scoreLiveFeedToken(t: TrendingToken): number {
  if (isFeedExcluded(t)) return -1000;

  let score = 0;
  const ch = Math.abs(t.change24h);
  if (ch >= 4 && ch <= 120) score += Math.min(40, ch * 0.45);
  if (ch > 120) score -= 15;

  const mc = t.marketCap ?? t.fdv ?? 0;
  if (mc > 0 && mc < 80_000_000) score += 18;
  else if (mc > 0 && mc < 500_000_000) score += 8;
  else if (mc > 2_000_000_000) score -= 25;

  if (t.liquidityUsd >= 40_000 && t.liquidityUsd <= 8_000_000) score += 14;
  if (t.liquidityUsd < 25_000) score -= 20;

  const turn = turnover(t);
  if (turn >= 0.35 && turn <= 12) score += Math.min(18, turn * 2);
  if (turn > 40) score -= 12;

  const bp = buyPressure(t);
  if (bp > 1.1) score += 8;
  if (bp < 0.85) score -= 6;

  if (t.volume24h > 80_000) score += Math.min(12, t.volume24h / 500_000);

  return score;
}

/**
 * Discovery hunter — favors meme launch band (2x–100x style movers, sub-$15M MC).
 * Used for Live Feed only.
 */
export function scoreDiscoveryHunterToken(t: TrendingToken): number {
  if (isFeedExcluded(t)) return -1000;

  let score = scoreLiveFeedToken(t);
  const ch = t.change24h;
  const abs = Math.abs(ch);

  if (ch >= 20 && ch <= 500) score += Math.min(35, (ch - 15) * 0.12);
  if (ch >= 100) score += 12;
  if (abs >= 8 && abs < 20) score += 8;

  const mc = t.marketCap ?? t.fdv ?? 0;
  const h1 = t.priceChange?.h1 ?? 0;
  const bp = buyPressure(t);
  if (mc >= 30_000 && mc <= 15_000_000) score += 22;
  else if (mc > 0 && mc < 30_000) score += 10;
  else if (mc > 80_000_000) {
    if (h1 >= 5 && bp > 1.1 && t.liquidityUsd >= 400_000) score += 14;
    else if (h1 >= 3 && bp > 1.05) score += 4;
    else score -= 6;
  }

  if (h1 > 12 && ch > 0) score += 14;
  if (h1 > 25) score += 8;

  const turn = turnover(t);
  if (turn >= 0.5 && turn <= 18) score += Math.min(16, turn * 1.5);

  if (t.sourceTags?.some((s) => /GMGN|launch|new|pump/i.test(s))) score += 16;
  if (t.discoveryTag?.includes("GMGN")) score += 10;

  return score;
}

/** Short label for feed rows — hunter tier (never hype rugs/honeypots). */
export function discoveryHunterLabel(
  t: TrendingToken,
  risk?: {
    security?: Pick<TokenSecurityReport, "honeypotRisk" | "scamRisk" | "label" | "scamLabel">;
    scam?: Pick<ScamAssessment, "isScam" | "scamType" | "label">;
  },
): string {
  if (risk?.security?.honeypotRisk || risk?.scam?.scamType === "honeypot") {
    return "Honeypot risk";
  }
  if (risk?.security?.scamRisk || risk?.scam?.isScam) {
    return "Rug risk";
  }
  const ch = t.change24h;
  const m5 = t.priceChange?.m5 ?? 0;
  const h1 = t.priceChange?.h1 ?? 0;
  if (ch > 8 && (m5 < -15 || h1 < -25)) return "Pump-dump risk";
  if (ch >= 80 && (m5 < -8 || h1 < -12)) return "Hype zone — confirm flow";
  if (ch >= 80) return "100x zone (gated)";
  if (ch >= 35) return "2x+ momentum";
  if (ch >= 15) return "Early runner";
  if (t.sourceTags?.some((s) => /GMGN|new|launch/i.test(s))) return "Fresh launch";
  return "Discovery";
}

/** Alpha: pro desk — signals, multi-timeframe, liquidity discipline. */
import { isAlphaGlitchOrSpam } from "./alpha-quality";

export function scoreAlphaCandidate(t: TrendingToken): number {
  if (isFeedExcluded(t) || isAlphaGlitchOrSpam(t)) return -1000;

  let score = scoreLiveFeedToken(t);
  const ch = t.change24h;
  if (ch >= 12 && ch <= 120) score += 28;
  if (ch >= 25 && ch <= 85) score += 14;
  if (ch > 180) score -= 35;
  if (ch > 120) score -= 18;
  if (ch < -35) score -= 12;

  const h1 = t.priceChange?.h1 ?? 0;
  const h6 = t.priceChange?.h6 ?? 0;
  if (h1 > 6 && h1 < 45 && ch > 0) score += 12;
  if (h6 > 10 && h6 < 60 && ch > 0) score += 8;

  if (t.liquidityUsd >= 55_000 && t.liquidityUsd <= 5_000_000) score += 16;
  if (t.liquidityUsd < 45_000) score -= 22;
  if (t.volume24h >= 40_000) score += 10;

  const bp = buyPressure(t);
  if (bp >= 1.14) score += 18;
  if (bp < 0.95) score -= 10;

  if (t.sourceTags?.some((s) => /signal|smart-money|KOL/i.test(s))) score += 24;
  if (t.sourceTags?.some((s) => /GMGN trending|five-min|pump/i.test(s))) score += 14;
  if (t.sourceTags?.some((s) => /GeckoTerminal/i.test(s))) score += 8;

  const mc = t.marketCap ?? t.fdv ?? 0;
  if (mc >= 150_000 && mc <= 40_000_000 && t.liquidityUsd >= 50_000) score += 15;

  return score;
}

export function curateLiveFeed<T extends TrendingToken>(tokens: T[], limit: number): T[] {
  return [...tokens]
    .filter((t) => scoreLiveFeedToken(t) > 0)
    .sort((a, b) => scoreLiveFeedToken(b) - scoreLiveFeedToken(a))
    .slice(0, limit);
}

/** Live Feed roster — discovery hunter scoring. */
export function curateDiscoveryFeed<T extends TrendingToken>(tokens: T[], limit: number): T[] {
  return [...tokens]
    .filter((t) => scoreDiscoveryHunterToken(t) > 0)
    .sort((a, b) => scoreDiscoveryHunterToken(b) - scoreDiscoveryHunterToken(a))
    .slice(0, limit);
}

/** Never return an empty live feed when Dex/Gecko returned tradable rows. */
export function ensureDiscoveryFeedMin<T extends TrendingToken>(tokens: T[], limit: number): T[] {
  const curated = curateDiscoveryFeed(tokens, limit);
  const min = Math.min(6, limit);
  if (curated.length >= min) return curated;

  const fallback = [...tokens]
    .filter((t) => !isFeedExcluded(t) && t.priceUsd > 0 && (t.liquidityUsd >= 3_000 || t.volume24h >= 8_000))
    .sort((a, b) => b.volume24h - a.volume24h || b.liquidityUsd - a.liquidityUsd)
    .slice(0, limit);

  if (fallback.length === 0) {
    return [...tokens]
      .filter((t) => !isFeedExcluded(t) && t.priceUsd > 0)
      .sort((a, b) => b.volume24h - a.volume24h)
      .slice(0, limit);
  }

  const seen = new Set(curated.map((t) => tokenKey(t)));
  const merged = [...curated];
  for (const t of fallback) {
    if (merged.length >= limit) break;
    const k = tokenKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(t);
  }
  return merged.length ? merged : fallback;
}

export function curateAlphaCandidates<T extends TrendingToken>(
  tokens: T[],
  liveKeys: Set<string>,
  limit: number,
  maxLiveOverlap = 0,
  liveSymbolKeys?: Set<string>,
): T[] {
  const deduped = dedupeFeedTokens(tokens.filter((t) => !isAlphaGlitchOrSpam(t)));
  const ranked = [...deduped]
    .filter((t) => scoreAlphaCandidate(t) > 0)
    .sort((a, b) => scoreAlphaCandidate(b) - scoreAlphaCandidate(a));

  const out: T[] = [];
  let overlap = 0;
  for (const t of ranked) {
    const k = tokenKey(t);
    const sym = symbolChainKey(t);
    const inLive = liveKeys.has(k) || (liveSymbolKeys?.has(sym) ?? false);
    if (inLive && overlap >= maxLiveOverlap) continue;
    if (inLive) overlap++;
    out.push(t);
    if (out.length >= limit) break;
  }

  if (out.length < Math.min(limit, 6)) {
    for (const t of ranked) {
      const k = tokenKey(t);
      const sym = symbolChainKey(t);
      if (out.some((x) => tokenKey(x) === k)) continue;
      const inLive = liveKeys.has(k) || (liveSymbolKeys?.has(sym) ?? false);
      if (inLive && maxLiveOverlap === 0) continue;
      out.push(t);
      if (out.length >= limit) break;
    }
  }

  return out;
}
