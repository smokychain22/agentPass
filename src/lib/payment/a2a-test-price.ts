import { microToUsdtLabel } from "./micro-usdt";

/** Production verified cleanup PR / A2A escrow price tiers (USDT). */
export const A2A_CLEANUP_PR_PRICE_PRODUCTION = {
  small: { amountMicro: "1000000", amountUsdt: 1, explanation: "Small repository (≤150 source files): 1 USDT" },
  medium: { amountMicro: "2000000", amountUsdt: 2, explanation: "Medium repository (151–400 source files): 2 USDT" },
  large: { amountMicro: "3000000", amountUsdt: 3, explanation: "Larger supported repository (>400 source files): 3 USDT" },
} as const;

/** Flat personal test price for A2A Cleanup Operator orders. */
export const A2A_CLEANUP_PR_PRICE_TEST = {
  amountMicro: "200000",
  amountUsdt: 0.2,
  priceLabel: "0.20 USDT",
  explanation: "Personal A2A test price: 0.20 USDT",
} as const;

function isA2aTestPriceEnabled(): boolean {
  return process.env.REPODIET_A2A_TEST_PRICE === "1";
}

export function getA2aCleanupPrTestPrice(): {
  amountMicro: string;
  amountUsdt: number;
  priceLabel: string;
  explanation: string;
} {
  const overrideMicro = process.env.REPODIET_A2A_TEST_PRICE_MICRO;
  if (overrideMicro && /^\d+$/.test(overrideMicro)) {
    const amountUsdt = Number(overrideMicro) / 1_000_000;
    return {
      amountMicro: overrideMicro,
      amountUsdt,
      priceLabel: microToUsdtLabel(overrideMicro),
      explanation: `Personal A2A test price: ${microToUsdtLabel(overrideMicro)}`,
    };
  }
  return { ...A2A_CLEANUP_PR_PRICE_TEST, priceLabel: A2A_CLEANUP_PR_PRICE_TEST.priceLabel };
}

export function isA2aTestPriceActive(): boolean {
  return (
    isA2aTestPriceEnabled() ||
    Boolean(
      process.env.REPODIET_A2A_TEST_PRICE_MICRO &&
        /^\d+$/.test(process.env.REPODIET_A2A_TEST_PRICE_MICRO)
    )
  );
}

export function isA2aTestPriceQuote(input: {
  operation?: string;
  amountMicro?: string;
}): boolean {
  if (!isA2aTestPriceActive()) return false;
  if (input.operation && input.operation !== "verified_cleanup_pr") return false;
  const test = getA2aCleanupPrTestPrice();
  return input.amountMicro === test.amountMicro;
}

export type WorkflowSettlementMode = "trusted_test" | "test_hmac" | "live_x402";

export function resolveWorkflowSettlementMode(input: {
  operation?: string;
  amountMicro?: string;
}): WorkflowSettlementMode {
  if (isA2aTestPriceQuote(input)) return "trusted_test";
  if (process.env.REQUIRE_REAL_X402 === "1") return "live_x402";
  if (process.env.REPODIET_X402_TEST_MODE === "1" || process.env.REPODIET_X402_TEST_SECRET) {
    return "test_hmac";
  }
  return "trusted_test";
}
