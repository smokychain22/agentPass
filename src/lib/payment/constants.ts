import { getCanonicalOkxIdentity } from "@/lib/okx/identity";

const okxIdentity = getCanonicalOkxIdentity();

export const X402_NETWORK = okxIdentity.network;
export const X402_CURRENCY = "USDT" as const;
export const X402_ASSET = okxIdentity.settlementAsset;
export const X402_RECIPIENT = okxIdentity.sellerWallet;
export const QUOTE_TTL_MS = 15 * 60 * 1000;
export const OPERATOR_ID = "repodiet-operator";
export const RECEIPT_VERSION = "1";
