/**
 * Exact payable amount formatting for buyer-facing quotes.
 * Never render negotiated marketing copy as the charge amount.
 */

export interface ExactPayableAmount {
  amountMicro: string;
  decimals: number;
  amountDisplay: string;
  currency: string;
  authorizeButtonLabel: string;
}

export function formatExactUsdtFromMicro(
  amountMicro: string,
  options?: { currency?: string; decimals?: number }
): ExactPayableAmount {
  const decimals = options?.decimals ?? 6;
  const currency = options?.currency ?? "USDT";
  const raw = BigInt(amountMicro || "0");
  const zero = BigInt(0);
  const negative = raw < zero;
  const abs = negative ? -raw : raw;
  const base = BigInt(10) ** BigInt(decimals);
  const whole = abs / base;
  const fraction = abs % base;
  const fractionStr = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  const amountDisplay = fractionStr
    ? `${negative ? "-" : ""}${whole.toString()}.${fractionStr.padEnd(2, "0").slice(0, Math.max(2, fractionStr.length))}`
    : `${negative ? "-" : ""}${whole.toString()}.00`;

  return {
    amountMicro: amountMicro || "0",
    decimals,
    amountDisplay,
    currency,
    authorizeButtonLabel: `Authorize ${amountDisplay} ${currency}`,
  };
}

/** Buyer-facing charge label — always exact numeric USDT, never "negotiated (…)". */
export function exactChargeLabelFromMicro(amountMicro: string, currency = "USDT"): string {
  const exact = formatExactUsdtFromMicro(amountMicro, { currency });
  return `${exact.amountDisplay} ${exact.currency}`;
}
