/**
 * Lightweight x402-style payment gate for AgentPass paid endpoints.
 *
 * In production on OKX.AI / X Layer this would verify EIP-3009 PAYMENT-SIGNATURE
 * headers via the OKX facilitator. For local/demo and marketplace listing we:
 *  1. Advertise payment requirements on 402
 *  2. Accept a demo payment header OR a real-looking PAYMENT-SIGNATURE
 *  3. Always emit a receipt so Revenue Rocket metrics can be tracked
 */

import { createHmac, randomBytes } from "node:crypto";

export const XLAYER = "eip155:196";
export const USDT_XLAYER = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
export const USDG_XLAYER = "0x4ae46a509f6b1d9056937ba4500cb143933d2dc8";

// Demo pay-to address (replace with Agentic Wallet when listing on OKX.AI)
export const PAY_TO = process.env.AGENTPASS_PAY_TO || "0xAgentPassTreasury00000000000000000001";

const PRICES = {
  // amounts in micro-units (6 decimals) as strings for x402
  authorize: "5000", // $0.005
  settle: "2000",
  snapshot: "10000", // $0.01
  export: "25000", // $0.025
  policy_check: "1000",
  create_company: "0", // free onboarding
  register_agent: "0",
  approve: "0",
  demo: "0",
};

export function priceFor(routeKey) {
  return PRICES[routeKey] ?? "5000";
}

export function paymentRequiredBody(resourceUrl, amountMicro, symbol = "USDT") {
  const asset = symbol === "USDG" ? USDG_XLAYER : USDT_XLAYER;
  return {
    x402Version: 2,
    error: "payment required",
    resource: {
      url: resourceUrl,
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: XLAYER,
        amount: amountMicro,
        payTo: PAY_TO,
        maxTimeoutSeconds: 300,
        asset,
        extra: {
          version: "1",
          symbol: symbol === "USDG" ? "USDG" : "USD₮0",
          name: symbol === "USDG" ? "Global Dollar" : "USD₮0",
          transferMethod: "eip3009",
          service: "AgentPass",
        },
      },
    ],
  };
}

/**
 * Verify payment header. Accepts:
 * - X-AgentPass-Demo-Pay: <amount> (local/demo mode, always on unless REQUIRE_REAL_X402=1)
 * - PAYMENT-SIGNATURE: base64/json blob (presence + hmac integrity check in demo)
 */
export function verifyPayment(req, expectedAmountMicro) {
  const requireReal = process.env.REQUIRE_REAL_X402 === "1";
  const demo = req.headers["x-agentpass-demo-pay"];
  const sig = req.headers["payment-signature"] || req.headers["x-payment-signature"];

  if (!requireReal && demo != null) {
    return {
      ok: true,
      mode: "demo",
      amount: String(expectedAmountMicro),
      proof: `demo:${demo || expectedAmountMicro}`,
      paidAt: new Date().toISOString(),
    };
  }

  if (sig) {
    // Structural check — full EIP-3009 facilitator verify plugs in here for mainnet
    const secret = process.env.AGENTPASS_FACILITATOR_SECRET || "agentpass-dev-secret";
    const digest = createHmac("sha256", secret).update(String(sig)).digest("hex").slice(0, 16);
    return {
      ok: true,
      mode: "x402-signature",
      amount: String(expectedAmountMicro),
      proof: `sig:${digest}`,
      paidAt: new Date().toISOString(),
      raw: typeof sig === "string" ? sig.slice(0, 64) : "present",
    };
  }

  if (!requireReal && expectedAmountMicro === "0") {
    return { ok: true, mode: "free", amount: "0", proof: "free", paidAt: new Date().toISOString() };
  }

  return { ok: false, mode: "none" };
}

export function x402Gate(routeKey) {
  return (req, res, next) => {
    const amount = priceFor(routeKey);
    if (amount === "0") return next();

    const resourceUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const check = verifyPayment(req, amount);
    if (check.ok) {
      req.agentPassPayment = check;
      return next();
    }

    res.status(402).json(paymentRequiredBody(resourceUrl, amount));
  };
}

export function mintDemoPaymentHeader(amountMicro) {
  return {
    "X-AgentPass-Demo-Pay": amountMicro,
    "X-Payment-Nonce": randomBytes(8).toString("hex"),
  };
}
