import { paymentRequiredBody } from "@/lib/payment/x402";
import type { EntitlementContext, EntitlementMode, EntitlementResult } from "./types";

export function resolveEntitlementMode(): EntitlementMode {
  if (process.env.REQUIRE_REAL_X402 === "1") return "live_x402";
  if (
    process.env.PUBLIC_BETA_FREE === "1" ||
    process.env.REPODIET_PUBLIC_BETA_FREE === "1" ||
    process.env.VERCEL_ENV === "preview" ||
    process.env.NODE_ENV !== "production"
  ) {
    return "free_beta";
  }
  if (process.env.REPODIET_X402_TEST_MODE === "1" || process.env.REPODIET_X402_TEST_SECRET) {
    return "test_payment";
  }
  return "free_beta";
}

const FREE_BETA_TOOLS = new Set([
  "quick_cleanup",
  "run_quick_cleanup",
  "generate_cleanup_patch",
  "patch_bundle",
  "verify_run",
  "create_cleanup_pr",
]);

const ALWAYS_FREE_TOOLS = new Set([
  "scan_repository",
  "scan_repo_bloat",
  "findings_analysis",
  "list_safe_fixes",
  "run_free_safe_fix",
  "free_proof",
  "get_findings",
  "get_repository_health",
]);

export function checkEntitlement(context: EntitlementContext): EntitlementResult {
  const mode = resolveEntitlementMode();

  if (ALWAYS_FREE_TOOLS.has(context.toolKey)) {
    return { allowed: true, mode, amountMicro: "0" };
  }

  if (mode === "free_beta" && FREE_BETA_TOOLS.has(context.toolKey)) {
    return { allowed: true, mode, amountMicro: "0" };
  }

  if (context.quoteId) {
    return { allowed: true, mode, quoteId: context.quoteId };
  }

  const request = context.request;
  if (request) {
    const demo = request.headers.get("x-repodiet-demo-pay");
    if (demo && mode !== "live_x402") {
      return { allowed: true, mode: "test_payment", amountMicro: demo };
    }
    const sig =
      request.headers.get("payment-signature") || request.headers.get("x-payment-signature");
    if (sig) {
      return { allowed: true, mode: "live_x402" };
    }
  }

  if (mode === "test_payment") {
    return {
      allowed: false,
      mode,
      reason: "Payment required. Use POST /api/tasks/quote then /api/tasks/pay.",
    };
  }

  if (mode === "live_x402") {
    return {
      allowed: false,
      mode,
      reason: "Payment required for this operation.",
    };
  }

  return { allowed: true, mode: "free_beta", amountMicro: "0" };
}

export function entitlementPaymentBody(resourceUrl: string, amountMicro: string, quoteId?: string) {
  return paymentRequiredBody(resourceUrl, amountMicro, quoteId);
}

export function isQuickCleanupFree(): boolean {
  return checkEntitlement({ toolKey: "quick_cleanup" }).allowed;
}
