import type { CommerceOperation } from "@/lib/payment/types";
import { getAnalyzeRepositoryPrice } from "@/lib/payment/analyze-repository-price";
import { getA2aCleanupPrTestPrice, isA2aTestPriceActive } from "@/lib/payment/a2a-test-price";

export interface CommercePrice {
  amountMicro: string;
  priceLabel: string;
  amountUsdt?: number;
}

function formatUsdtLabel(amountMicro: string): string {
  const amount = Number(amountMicro) / 1_000_000;
  return `${amount.toFixed(amount >= 0.01 ? 2 : 6).replace(/\.?0+$/, "")} USDT`;
}

export function resolveCommercePrice(
  operation: CommerceOperation,
  options?: { sourceFileCount?: number }
): CommercePrice {
  switch (operation) {
    case "scan_repository":
      return { amountMicro: "10000", priceLabel: "0.01 USDT", amountUsdt: 0.01 };
    case "analyze_repository": {
      const price = getAnalyzeRepositoryPrice();
      return {
        amountMicro: price.amountMicro,
        priceLabel: price.priceLabel,
        amountUsdt: Number(price.amountMicro) / 1_000_000,
      };
    }
    case "list_safe_fixes":
      return { amountMicro: "10000", priceLabel: "0.01 USDT", amountUsdt: 0.01 };
    case "verify_patch":
      return { amountMicro: "50000", priceLabel: "0.05 USDT", amountUsdt: 0.05 };
    case "repository_health_delta":
      return { amountMicro: "30000", priceLabel: "0.03 USDT", amountUsdt: 0.03 };
    case "free_proof":
      return { amountMicro: "0", priceLabel: "Free", amountUsdt: 0 };
    case "quick_cleanup":
      return { amountMicro: "250000", priceLabel: "0.25 USDT", amountUsdt: 0.25 };
    case "verified_cleanup_pr": {
      if (isA2aTestPriceActive()) {
        const test = getA2aCleanupPrTestPrice();
        return {
          amountMicro: test.amountMicro,
          priceLabel: test.priceLabel,
          amountUsdt: test.amountUsdt,
        };
      }
      const tier = classifyRepoSize(options?.sourceFileCount ?? 200);
      const amountUsdt = tier === "small" ? 1 : tier === "medium" ? 2 : 3;
      const amountMicro = String(amountUsdt * 1_000_000);
      return { amountMicro, priceLabel: `${amountUsdt} USDT`, amountUsdt };
    }
    case "repo_guard":
      return { amountMicro: "4000000", priceLabel: "4 USDT/month", amountUsdt: 4 };
    default:
      return { amountMicro: "0", priceLabel: "Free", amountUsdt: 0 };
  }
}

export function classifyRepoSize(sourceFileCount: number): "small" | "medium" | "large" {
  if (sourceFileCount <= 150) return "small";
  if (sourceFileCount <= 400) return "medium";
  return "large";
}
