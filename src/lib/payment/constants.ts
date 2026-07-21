import {
  DEFAULT_IDENTITY,
  getCanonicalOkxIdentity,
} from "@/lib/okx/identity";

// Next imports the server module graph while `next build` is performing static
// analysis. Environment conflicts must still fail closed when a request reaches
// the payment runtime, but they must not make a deployment artifact impossible
// to build before a request exists.
const okxIdentity =
  process.env.NEXT_PHASE === "phase-production-build"
    ? DEFAULT_IDENTITY
    : getCanonicalOkxIdentity();

export const X402_NETWORK = okxIdentity.network;
export const X402_CURRENCY = "USDT" as const;
export const X402_ASSET = okxIdentity.settlementAsset;
export const X402_RECIPIENT = okxIdentity.sellerWallet;
export const QUOTE_TTL_MS = 15 * 60 * 1000;
export const OPERATOR_ID = "repodiet-operator";
export const RECEIPT_VERSION = "1";
