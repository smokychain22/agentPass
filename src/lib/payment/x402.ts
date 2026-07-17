import { X402_ASSET, X402_NETWORK, X402_RECIPIENT } from "./constants";
import { checkEntitlement } from "@/lib/entitlement/service";

export { X402_NETWORK, X402_ASSET, X402_RECIPIENT };
export const XLAYER = X402_NETWORK;
export const USDT_XLAYER = X402_ASSET;
export const PAY_TO = X402_RECIPIENT;

export interface PaymentVerification {
  ok: boolean;
  mode?: "free" | "demo" | "x402-signature" | "quote-bound";
  amount?: string;
  paidAt?: string;
  quoteId?: string;
}

export function paymentRequiredBody(
  resourceUrl: string,
  amountMicro: string,
  quoteId?: string
) {
  return {
    x402Version: 2,
    error: "payment required",
    resource: { url: resourceUrl, mimeType: "application/json" },
    quoteId,
    accepts: [
      {
        scheme: "exact",
        network: X402_NETWORK,
        amount: amountMicro,
        payTo: X402_RECIPIENT,
        maxTimeoutSeconds: 300,
        asset: X402_ASSET,
        extra: {
          version: "1",
          symbol: "USDT",
          name: "USDT",
          currency: "USDT",
          transferMethod: "eip3009",
          service: "RepoDiet",
          quoteId,
        },
      },
    ],
  };
}

export function verifyPayment(request: Request, expectedMicro: string): PaymentVerification {
  if (expectedMicro === "0") {
    return { ok: true, mode: "free", amount: "0", paidAt: new Date().toISOString() };
  }

  const quoteId = request.headers.get("x-repodiet-quote-id");
  if (quoteId) {
    return {
      ok: true,
      mode: "quote-bound",
      amount: expectedMicro,
      paidAt: new Date().toISOString(),
      quoteId,
    };
  }

  if (process.env.REQUIRE_REAL_X402 !== "1") {
    const demo = request.headers.get("x-repodiet-demo-pay");
    if (demo != null) {
      return { ok: true, mode: "demo", amount: expectedMicro, paidAt: new Date().toISOString() };
    }
  }

  // Unsigned payment-signature is never sufficient under REQUIRE_REAL_X402.
  // Marketplace paid paths must verify through the A2MCP/A2A payment pipelines.
  if (process.env.REQUIRE_REAL_X402 === "1") {
    return { ok: false };
  }

  const sig =
    request.headers.get("payment-signature") || request.headers.get("x-payment-signature");
  if (sig) {
    return {
      ok: true,
      mode: "x402-signature",
      amount: expectedMicro,
      paidAt: new Date().toISOString(),
    };
  }

  return { ok: false };
}

export function enforcePayment(
  request: Request,
  toolKey: string,
  options?: { free?: boolean; amountMicro?: string }
): PaymentVerification {
  // Demo-repo free paths are never allowed under live marketplace payment mode.
  const live =
    process.env.REQUIRE_REAL_X402 === "1" ||
    (process.env.NODE_ENV === "production" &&
      process.env.VERCEL_ENV === "production" &&
      process.env.PUBLIC_BETA_FREE !== "1" &&
      process.env.REPODIET_PUBLIC_BETA_FREE !== "1");
  if (options?.free && live) {
    const amount = options.amountMicro ?? priceFor(toolKey);
    const url = new URL(request.url).toString();
    const err = new Error("Payment required");
    (err as Error & { status: number; body: unknown }).status = 402;
    (err as Error & { status: number; body: unknown }).body = paymentRequiredBody(url, amount);
    throw err;
  }
  if (options?.free) {
    return { ok: true, mode: "free", amount: "0", paidAt: new Date().toISOString() };
  }

  const entitlement = checkEntitlement({ toolKey, request });
  if (entitlement.allowed) {
    return {
      ok: true,
      mode: entitlement.mode === "free_beta" ? "demo" : entitlement.mode === "test_payment" ? "demo" : "quote-bound",
      amount: entitlement.amountMicro ?? options?.amountMicro ?? "0",
      paidAt: new Date().toISOString(),
      quoteId: entitlement.quoteId,
    };
  }

  const amount = options?.amountMicro ?? priceFor(toolKey);
  const url = new URL(request.url).toString();
  const err = new Error("Payment required");
  (err as Error & { status: number; body: unknown }).status = 402;
  (err as Error & { status: number; body: unknown }).body = paymentRequiredBody(url, amount);
  throw err;
}

export function priceFor(tool: string): string {
  const PRICES: Record<string, string> = {
    scan_repo_bloat: "20000",
    detect_duplicate_code: "20000",
    find_dead_files: "20000",
    find_unused_dependencies: "20000",
    findings_analysis: "50000",
    generate_cleanup_patch: "100000",
    generate_regression_checklist: "50000",
    patch_bundle: "250000",
    quick_cleanup: "250000",
    verify_run: "50000",
    create_cleanup_pr: "1000000",
    repo_guard_monthly: "4000000",
    free: "0",
  };
  return PRICES[tool] ?? "50000";
}
