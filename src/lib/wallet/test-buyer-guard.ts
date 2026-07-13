/** Internal funded E2E buyer — never exposed to browser customers. */

export function isInternalTestBuyerAllowed(): boolean {
  if (process.env.ALLOW_INTERNAL_TEST_BUYER !== "1") return false;
  if (process.env.VERCEL_ENV === "production") return false;
  if (process.env.NODE_ENV === "production" && !process.env.REPODIET_X402_TEST_MODE) {
    return false;
  }
  return true;
}

export function rejectInternalTestBuyerForCustomer(input: {
  payer?: string;
  isServerTestRoute?: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (input.isServerTestRoute && isInternalTestBuyerAllowed()) {
    return { ok: true };
  }

  const internalPayer = readInternalTestBuyerAddress();
  if (!internalPayer || !input.payer) return { ok: true };

  if (input.payer.toLowerCase() === internalPayer.toLowerCase()) {
    return {
      ok: false,
      reason: "Internal test buyer wallet cannot be used for customer payments.",
    };
  }

  return { ok: true };
}

function readInternalTestBuyerAddress(): string | undefined {
  const candidates = [
    process.env.REPODIET_TEST_BUYER_ADDRESS,
    process.env.INTERNAL_TEST_BUYER_ADDRESS,
  ];
  for (const value of candidates) {
    const trimmed = value?.trim();
    if (trimmed?.startsWith("0x")) return trimmed;
  }
  return undefined;
}
