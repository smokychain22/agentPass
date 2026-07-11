/**
 * x402 payment gate for RepoDiet A2MCP tools (X Layer / OKX.AI).
 * Demo mode: X-RepoDiet-Demo-Pay header. Production: PAYMENT-SIGNATURE via OKX facilitator.
 */

export const XLAYER = "eip155:196";
export const USDT_XLAYER = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
export const PAY_TO = process.env.REPODIET_PAY_TO || "0xRepoDietTreasury00000000000000001";

// amounts in micro-USDT (6 decimals)
const PRICES = {
  scan_repo_bloat: "50000",
  detect_duplicate_code: "50000",
  find_dead_files: "30000",
  find_unused_dependencies: "30000",
  generate_cleanup_patch: "150000",
  generate_regression_checklist: "250000",
  quick_scan: "50000",
  deep_scan: "150000",
  patch_bundle: "250000",
  free: "0",
};

export function priceFor(tool) {
  return PRICES[tool] ?? "50000";
}

export function paymentRequiredBody(resourceUrl, amountMicro) {
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

export function verifyPayment(req, expectedMicro) {
  if (expectedMicro === "0") {
    return { ok: true, mode: "free", amount: "0", paidAt: now() };
  }
  const requireReal = process.env.REQUIRE_REAL_X402 === "1";
  const demo = req.headers["x-repodiet-demo-pay"];
  const sig = req.headers["payment-signature"] || req.headers["x-payment-signature"];
  if (!requireReal && demo != null) {
    return { ok: true, mode: "demo", amount: expectedMicro, paidAt: now() };
  }
  if (sig) {
    return { ok: true, mode: "x402-signature", amount: expectedMicro, paidAt: now() };
  }
  return { ok: false };
}

function now() {
  return new Date().toISOString();
}

export function x402Gate(toolKey) {
  return (req, res, next) => {
    const amount = priceFor(toolKey);
    if (amount === "0") return next();
    const check = verifyPayment(req, amount);
    if (check.ok) {
      req.repodietPayment = check;
      return next();
    }
    const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    return res.status(402).json(paymentRequiredBody(url, amount));
  };
}

export function demoPayHeaders(tool) {
  return { "X-RepoDiet-Demo-Pay": priceFor(tool) };
}
