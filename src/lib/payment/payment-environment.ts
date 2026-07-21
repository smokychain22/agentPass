/**
 * Canonical payment environment for RepoDiet commerce.
 * Explicit testnet vs mainnet — never silently switch.
 */

export const MAINNET_NETWORK = "eip155:196" as const;
export const MAINNET_CHAIN_ID = 196 as const;
export const MAINNET_USDT = "0x779ded0c9e1022225f8e0630b35a9b54be713736" as const;

export const TESTNET_NETWORK = "eip155:1952" as const;
export const TESTNET_CHAIN_ID = 1952 as const;
export const TESTNET_USDT = "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c" as const;

export type PaymentMode = "testnet" | "mainnet" | "unset";

export interface PaymentEnvironment {
  paymentMode: PaymentMode;
  environment: "testnet" | "mainnet" | "unset";
  network: string;
  chainId: number | null;
  asset: string;
  sellerWallet: string;
  buyerWallet: string;
  /** True when mode is testnet and network/asset match testnet constants. */
  isTestnet: boolean;
  /** True when network or asset is mainnet (eip155:196 / real USDT). */
  isMainnet: boolean;
  /** Hard stop — testnet mode requested but mainnet material detected. */
  mainnetBlocked: boolean;
  blockReason?: string;
}

function address(value: string | undefined, fallback: string): string {
  const raw = (value ?? fallback).trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(raw)) {
    throw new Error(`invalid_payment_address:${raw.slice(0, 12)}`);
  }
  return raw;
}

export function resolvePaymentMode(env: NodeJS.ProcessEnv = process.env): PaymentMode {
  // Prefer REPODIET_PAYMENT_ENV (testnet|production) then REPODIET_PAYMENT_MODE (testnet|mainnet).
  const envAlias = (env.REPODIET_PAYMENT_ENV || "").trim().toLowerCase();
  if (envAlias === "testnet") return "testnet";
  if (envAlias === "production" || envAlias === "mainnet") return "mainnet";

  const explicit = (env.REPODIET_PAYMENT_MODE || "").trim().toLowerCase();
  if (explicit === "testnet" || explicit === "mainnet") return explicit;
  if (explicit === "production") return "mainnet";
  // Legacy aliases — do not invent a mode from VERCEL_ENV alone.
  if ((env.REPODIET_X402_NETWORK || "").trim() === TESTNET_NETWORK) return "testnet";
  if ((env.REPODIET_X402_NETWORK || "").trim() === MAINNET_NETWORK) return "mainnet";
  return "unset";
}

/**
 * Fail closed when production/mainnet mode is selected but network/asset/payee are incomplete
 * or resolve to testnet terms.
 */
export function assertProductionPaymentConfig(
  env: NodeJS.ProcessEnv = process.env
): PaymentEnvironment {
  const pe = getPaymentEnvironment(env);
  if (pe.paymentMode !== "mainnet") {
    const err = new Error(
      "PRODUCTION_PAYMENT_CONFIG_REQUIRED: set REPODIET_PAYMENT_ENV=production (or REPODIET_PAYMENT_MODE=mainnet)."
    );
    (err as Error & { code: string }).code = "PRODUCTION_PAYMENT_CONFIG_REQUIRED";
    throw err;
  }
  if (pe.network !== MAINNET_NETWORK || pe.chainId !== MAINNET_CHAIN_ID || pe.asset !== MAINNET_USDT) {
    const err = new Error(
      `PRODUCTION_PAYMENT_MISMATCH: expected ${MAINNET_NETWORK} / ${MAINNET_USDT}, got ${pe.network} / ${pe.asset}`
    );
    (err as Error & { code: string }).code = "PRODUCTION_PAYMENT_MISMATCH";
    throw err;
  }
  if (pe.isTestnet) {
    const err = new Error("PRODUCTION_PAYMENT_MIXED: production mode must never emit testnet terms.");
    (err as Error & { code: string }).code = "PRODUCTION_PAYMENT_MIXED";
    throw err;
  }
  const payTo =
    env.OKX_AGENTIC_WALLET_ADDRESS?.trim() ||
    env.PAY_TO_ADDRESS?.trim() ||
    env.REPODIET_PAY_TO?.trim();
  if (!payTo || !/^0x[a-fA-F0-9]{40}$/.test(payTo)) {
    const err = new Error(
      "PRODUCTION_PAYMENT_PAYEE_MISSING: set OKX_AGENTIC_WALLET_ADDRESS / PAY_TO_ADDRESS to a valid EVM address."
    );
    (err as Error & { code: string }).code = "PRODUCTION_PAYMENT_PAYEE_MISSING";
    throw err;
  }
  return pe;
}

export function getPaymentEnvironment(env: NodeJS.ProcessEnv = process.env): PaymentEnvironment {
  const paymentMode = resolvePaymentMode(env);

  const network =
    env.REPODIET_PAYMENT_NETWORK?.trim() ||
    env.REPODIET_X402_NETWORK?.trim() ||
    (paymentMode === "testnet" ? TESTNET_NETWORK : paymentMode === "mainnet" ? MAINNET_NETWORK : MAINNET_NETWORK);

  const chainIdRaw =
    env.REPODIET_PAYMENT_CHAIN_ID?.trim() ||
    (network.includes(":") ? network.split(":")[1] : undefined);
  const chainId = chainIdRaw && /^\d+$/.test(chainIdRaw) ? Number(chainIdRaw) : null;

  const asset = address(
    env.REPODIET_PAYMENT_ASSET || env.REPODIET_X402_ASSET,
    paymentMode === "testnet" ? TESTNET_USDT : MAINNET_USDT
  );

  const sellerWallet = address(
    env.OKX_AGENTIC_WALLET_ADDRESS || env.PAY_TO_ADDRESS || env.REPODIET_PAY_TO,
    "0x1339724ada3adf04bb7a8ccc6498216214bbdf90"
  );
  const buyerWallet = address(
    env.NEXT_PUBLIC_REPODIET_OWNER_BUYER_WALLET,
    "0xaa895234c3fc31c40018eef975db6ac79bf87f1a"
  );

  const isMainnet =
    network === MAINNET_NETWORK ||
    chainId === MAINNET_CHAIN_ID ||
    asset === MAINNET_USDT;
  const isTestnet =
    network === TESTNET_NETWORK ||
    chainId === TESTNET_CHAIN_ID ||
    asset === TESTNET_USDT;

  let mainnetBlocked = false;
  let blockReason: string | undefined;

  if (paymentMode === "testnet" && isMainnet) {
    mainnetBlocked = true;
    blockReason =
      "MAINNET_CONFIGURATION_DETECTED: REPODIET_PAYMENT_MODE=testnet but network/asset resolve to mainnet (eip155:196 / real USD₮0). NO_TRANSACTION_SENT.";
  }

  if (paymentMode === "testnet") {
    if (network !== TESTNET_NETWORK || chainId !== TESTNET_CHAIN_ID || asset !== TESTNET_USDT) {
      mainnetBlocked = true;
      blockReason =
        blockReason ||
        `MAINNET_CONFIGURATION_DETECTED_OR_MISMATCH: expected ${TESTNET_NETWORK} / ${TESTNET_USDT}, got ${network} / ${asset}. NO_TRANSACTION_SENT.`;
    }
  }

  return {
    paymentMode,
    environment: paymentMode === "unset" ? "unset" : paymentMode,
    network,
    chainId,
    asset,
    sellerWallet,
    buyerWallet,
    isTestnet: paymentMode === "testnet" && isTestnet && !mainnetBlocked,
    isMainnet,
    mainnetBlocked,
    blockReason,
  };
}

/** Throw before any signing / settlement when testnet mode sees mainnet material. */
export function assertTestnetPaymentSafe(env: NodeJS.ProcessEnv = process.env): PaymentEnvironment {
  const pe = getPaymentEnvironment(env);
  if (pe.mainnetBlocked) {
    const err = new Error(pe.blockReason || "MAINNET_CONFIGURATION_DETECTED");
    (err as Error & { code: string }).code = "MAINNET_CONFIGURATION_DETECTED";
    throw err;
  }
  if (pe.paymentMode !== "testnet") {
    const err = new Error(
      "OWNER_ACTION_REQUIRED: set REPODIET_PAYMENT_MODE=testnet (and matching network/asset) on the Preview deployment before testnet settlement."
    );
    (err as Error & { code: string }).code = "OWNER_ACTION_REQUIRED";
    throw err;
  }
  return pe;
}

export function paymentEnvironmentFields(pe: PaymentEnvironment) {
  return {
    environment: pe.environment,
    paymentMode: pe.paymentMode,
    network: pe.network,
    chainId: pe.chainId,
    asset: pe.asset,
  };
}
