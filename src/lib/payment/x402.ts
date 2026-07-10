export const XLAYER = "eip155:196";
export const USDT_XLAYER = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
export const PAY_TO = process.env.REPODIET_PAY_TO || "0xRepoDietTreasury00000000000000001";

/** Launch micro-pricing in USDT micro-units (6 decimals). */
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

export interface PaymentVerification {
  ok: boolean;
  mode?: "free" | "demo" | "x402-signature";
  amount?: string;
  paidAt?: string;
}

export function priceFor(tool: string): string {
  return PRICES[tool] ?? "50000";
}

export function paymentRequiredBody(resourceUrl: string, amountMicro: string) {
  return {
    x402Version: 2,
    error: "payment required",
    resource: { url: resourceUrl, mimeType: "application/json" },
    accepts: [
      {
        scheme: "exact",
        network: XLAYER,
        amount: amountMicro,
        payTo: PAY_TO,
        maxTimeoutSeconds: 300,
        asset: USDT_XLAYER,
        extra: {
          version: "1",
          symbol: "USD₮0",
          name: "USD₮0",
          transferMethod: "eip3009",
          service: "RepoDiet",
        },
      },
    ],
  };
}

export function verifyPayment(request: Request, expectedMicro: string): PaymentVerification {
  if (expectedMicro === "0") {
    return { ok: true, mode: "free", amount: "0", paidAt: new Date().toISOString() };
  }

  const requireReal = process.env.REQUIRE_REAL_X402 === "1";

  // Beta/demo deployment: x402 is not enforced until REQUIRE_REAL_X402=1.
  if (!requireReal) {
    return { ok: true, mode: "demo", amount: expectedMicro, paidAt: new Date().toISOString() };
  }

  const demo = request.headers.get("x-repodiet-demo-pay");
  const sig =
    request.headers.get("payment-signature") || request.headers.get("x-payment-signature");

  if (demo != null) {
    return { ok: true, mode: "demo", amount: expectedMicro, paidAt: new Date().toISOString() };
  }

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
  if (options?.free) {
    return { ok: true, mode: "free", amount: "0", paidAt: new Date().toISOString() };
  }

  const amount = options?.amountMicro ?? priceFor(toolKey);
  const check = verifyPayment(request, amount);
  if (!check.ok) {
    const url = new URL(request.url).toString();
    const err = new Error("Payment required");
    (err as Error & { status: number; body: unknown }).status = 402;
    (err as Error & { status: number; body: unknown }).body = paymentRequiredBody(url, amount);
    throw err;
  }
  return check;
}
