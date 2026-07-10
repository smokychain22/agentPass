export const X402_NETWORK = "eip155:196";
export const X402_CURRENCY = "USDT" as const;
export const X402_ASSET = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
export const X402_RECIPIENT =
  process.env.REPODIET_PAY_TO || "0xRepoDietTreasury00000000000000001";
export const QUOTE_TTL_MS = 15 * 60 * 1000;
export const OPERATOR_ID = "repodiet-operator";
export const RECEIPT_VERSION = "1";
