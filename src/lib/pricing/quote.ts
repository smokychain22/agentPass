import { classifyRepoSize, resolveCommercePrice } from "@/lib/pricing/commerce-price";

export type RepoSizeTier = "small" | "medium" | "large";

export interface CleanupPrPriceQuote {
  tier: RepoSizeTier;
  amountUsdt: number;
  amountMicro: string;
  explanation: string;
}

export { classifyRepoSize };

export function quoteCleanupPrPrice(sourceFileCount: number): CleanupPrPriceQuote {
  const tier = classifyRepoSize(sourceFileCount);
  const price = resolveCommercePrice("verified_cleanup_pr", { sourceFileCount });
  const amountUsdt = price.amountUsdt ?? Number(price.amountMicro) / 1_000_000;
  const explanation =
    tier === "small"
      ? "Small repository (≤150 source files): 1 USDT"
      : tier === "medium"
        ? "Medium repository (151–400 source files): 2 USDT"
        : "Larger supported repository (>400 source files): 3 USDT";
  return {
    tier,
    amountUsdt,
    amountMicro: price.amountMicro,
    explanation: price.priceLabel === "0.20 USDT" ? price.priceLabel : explanation,
  };
}

export const AGENT_API_LAUNCH_PRICES = [
  { operation: "structure_scan", tool: "scan_repo_bloat", price: "0.02 USDT", amountMicro: "20000" },
  { operation: "findings_analysis", tool: "scan_repo_bloat", price: "0.05 USDT", amountMicro: "50000" },
  { operation: "safe_fix_proposal", tool: "generate_cleanup_patch", price: "0.10 USDT", amountMicro: "100000" },
  { operation: "verified_limited_cleanup", tool: "patch_bundle", price: "0.25 USDT", amountMicro: "250000" },
  { operation: "cleanup_pr", tool: "create_cleanup_pr", price: "1–3 USDT", amountMicro: "dynamic" },
] as const;

export const REPO_GUARD_MONTHLY_USDT = { min: 3, max: 5 };
