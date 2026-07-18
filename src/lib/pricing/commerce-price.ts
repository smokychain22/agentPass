import type { CommerceOperation } from "@/lib/payment/types";
import { getAnalyzeRepositoryPrice } from "@/lib/payment/analyze-repository-price";
import { getA2aCleanupPrTestPrice, isA2aTestPriceActive } from "@/lib/payment/a2a-test-price";
import { exactChargeLabelFromMicro } from "@/lib/pricing/exact-amount";

export interface CommercePrice {
  amountMicro: string;
  priceLabel: string;
  amountUsdt?: number;
  /** Marketing / negotiation hint — never use as the payable charge label. */
  negotiationHint?: string;
}

function formatUsdtLabel(amountMicro: string): string {
  return exactChargeLabelFromMicro(amountMicro, "USDT");
}

export function resolveCommercePrice(
  operation: CommerceOperation,
  options?: {
    sourceFileCount?: number;
    /** Dynamic amount from TransformationPlan quote engine (atomic micro units). */
    dynamicAmountMicro?: string;
    pathCount?: number;
    proposedAction?: string;
  }
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
      // Prefer plan-bound dynamic quote when provided.
      if (options?.dynamicAmountMicro && /^\d+$/.test(options.dynamicAmountMicro)) {
        return {
          amountMicro: options.dynamicAmountMicro,
          priceLabel: formatUsdtLabel(options.dynamicAmountMicro),
          amountUsdt: Number(options.dynamicAmountMicro) / 1_000_000,
        };
      }
      // Fallback heuristic when no plan quote exists yet (never a universal fixed 1.00).
      const paths = Math.max(1, options?.pathCount ?? options?.sourceFileCount ? 1 : 1);
      const action = (options?.proposedAction ?? "DELETE").toUpperCase();
      let micro =
        250_000 + // base
        150_000 * paths + // per path
        200_000; // validation
      if (action.includes("CONSOLIDATE") || action.includes("DUPLICATE")) micro += 750_000;
      else if (action.includes("EDIT") || action.includes("CUSTOM")) micro += 300_000;
      else micro += 100_000; // delete
      const amountMicro = String(micro);
      return {
        amountMicro,
        priceLabel: formatUsdtLabel(amountMicro),
        amountUsdt: micro / 1_000_000,
      };
    }
    case "repo_guard":
      // Not part of the public OKX listing model.
      return { amountMicro: "0", priceLabel: "not listed", amountUsdt: 0 };
    default:
      return { amountMicro: "0", priceLabel: "Free", amountUsdt: 0 };
  }
}

export function classifyRepoSize(sourceFileCount: number): "small" | "medium" | "large" {
  if (sourceFileCount <= 150) return "small";
  if (sourceFileCount <= 400) return "medium";
  return "large";
}
