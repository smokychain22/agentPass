import { microToUsdtLabel } from "./micro-usdt";

/** Production Quick Triage / analyze_repository x402 price. */
export const ANALYZE_REPOSITORY_PRICE_PRODUCTION = {
  amountMicro: "30000",
  priceLabel: "0.03 USDT",
} as const;

/** Personal test price for live buyer/seller payment proofs. */
export const ANALYZE_REPOSITORY_PRICE_TEST = {
  amountMicro: "200000",
  priceLabel: "0.20 USDT",
} as const;

function isTestPriceEnabled(): boolean {
  return process.env.REPODIET_A2MCP_TEST_PRICE === "1";
}

export function getAnalyzeRepositoryPrice(): {
  amountMicro: string;
  priceLabel: string;
} {
  const overrideMicro = process.env.REPODIET_A2MCP_TEST_PRICE_MICRO;
  if (overrideMicro && /^\d+$/.test(overrideMicro)) {
    return {
      amountMicro: overrideMicro,
      priceLabel: microToUsdtLabel(overrideMicro),
    };
  }
  if (isTestPriceEnabled()) {
    return { ...ANALYZE_REPOSITORY_PRICE_TEST };
  }
  return { ...ANALYZE_REPOSITORY_PRICE_PRODUCTION };
}

export function isAnalyzeRepositoryTestPriceActive(): boolean {
  return (
    isTestPriceEnabled() ||
    Boolean(
      process.env.REPODIET_A2MCP_TEST_PRICE_MICRO &&
        /^\d+$/.test(process.env.REPODIET_A2MCP_TEST_PRICE_MICRO)
    )
  );
}
