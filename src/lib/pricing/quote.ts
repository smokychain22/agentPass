import { classifyRepoSize, resolveCommercePrice } from "@/lib/pricing/commerce-price";

export type RepoSizeTier = "small" | "medium" | "large";

export interface CleanupPrPriceQuote {
  tier: RepoSizeTier;
  amountUsdt: number;
  amountMicro: string;
  explanation: string;
}

export { classifyRepoSize };

/** Scope-aware reference quote for A2A Verified Cleanup PR (dynamic; not a fixed 1.00). */
export function quoteCleanupPrPrice(sourceFileCount: number): CleanupPrPriceQuote {
  const tier = classifyRepoSize(sourceFileCount);
  const price = resolveCommercePrice("verified_cleanup_pr", { sourceFileCount });
  const amountUsdt = price.amountUsdt ?? Number(price.amountMicro) / 1_000_000;
  return {
    tier,
    amountUsdt,
    amountMicro: price.amountMicro,
    explanation:
      price.priceLabel.includes("0.20") || price.priceLabel.includes("0.2 ")
        ? price.priceLabel
        : `A2A Verified Cleanup PR: dynamic scope-based quote (${price.priceLabel}); OKX marketplace minimum may apply separately`,
  };
}

export const AGENT_API_LAUNCH_PRICES = [
  {
    operation: "A2MCP Quick Triage",
    tool: "analyze_repository",
    price: "0.03 USD₮0",
    amountMicro: "30000",
  },
  {
    operation: "A2A Verified Cleanup PR",
    tool: "create_cleanup_pr",
    price: "negotiated (default 1 USD₮0)",
    amountMicro: "1000000",
  },
] as const;
