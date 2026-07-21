/**
 * Production x402 server configuration validation.
 *
 * All server-side payment parameters (network, asset, amount, payTo, resource URL)
 * are read from the server environment. They are NEVER accepted from request bodies.
 *
 * This module validates the configuration at startup / first use and fails closed —
 * an invalid or missing configuration throws immediately rather than silently
 * substituting testnet or placeholder values.
 */

import {
  MAINNET_NETWORK,
  MAINNET_USDT,
} from "@/lib/payment/payment-environment";

export const QUICK_TRIAGE_AMOUNT = "30000" as const;
export const QUICK_TRIAGE_RESOURCE_PATH = "/api/a2mcp/quick-triage" as const;

export interface X402ProductionConfig {
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  resourceUrl: string;
}

function isValidEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isValidPositiveAtomicAmount(value: string): boolean {
  return /^\d+$/.test(value) && Number(value) > 0;
}

function isValidHttpsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validate and return the canonical x402 production config for the quick-triage
 * endpoint. Throws with a descriptive error when any required value is missing
 * or does not match production constants.
 *
 * Call at the top of the route handler before issuing any 402 response so that
 * misconfigured deployments fail immediately with a 500 rather than silently
 * issuing invalid challenges.
 */
export function getValidatedX402Config(
  getPayTo: () => string,
  getResourceUrl: () => string,
  env: NodeJS.ProcessEnv = process.env
): X402ProductionConfig {
  // --- Network ---
  const network = env.REPODIET_PAYMENT_NETWORK?.trim() ||
    env.REPODIET_X402_NETWORK?.trim() ||
    MAINNET_NETWORK;

  if (network !== MAINNET_NETWORK) {
    throw new Error(
      `x402_config_invalid: production network must be exactly "${MAINNET_NETWORK}", got "${network}". ` +
      `Do not mix testnet configuration into production. ` +
      `Set REPODIET_PAYMENT_NETWORK=${MAINNET_NETWORK} or leave unset for the mainnet default.`
    );
  }

  // --- Asset ---
  const asset = (
    env.REPODIET_PAYMENT_ASSET?.trim() ||
    env.REPODIET_X402_ASSET?.trim() ||
    MAINNET_USDT
  ).toLowerCase();

  if (asset !== MAINNET_USDT) {
    throw new Error(
      `x402_config_invalid: production asset must be the official X Layer USD₮0 contract ` +
      `"${MAINNET_USDT}", got "${asset}". ` +
      `Do not substitute a different token or testnet asset in production.`
    );
  }

  // --- Amount ---
  const amount = QUICK_TRIAGE_AMOUNT;
  if (!isValidPositiveAtomicAmount(amount)) {
    throw new Error(
      `x402_config_invalid: amount "${amount}" is not a valid positive atomic-unit string.`
    );
  }

  // --- payTo ---
  const payTo = getPayTo();
  if (!payTo) {
    throw new Error(
      `x402_config_invalid: payTo address is not configured. ` +
      `Set OKX_AGENTIC_WALLET_ADDRESS, PAY_TO_ADDRESS, or REPODIET_PAY_TO in your deployment environment.`
    );
  }
  if (!isValidEvmAddress(payTo)) {
    throw new Error(
      `x402_config_invalid: payTo "${payTo}" is not a valid EVM address.`
    );
  }

  // --- Resource URL ---
  const resourceUrl = getResourceUrl();
  if (!resourceUrl) {
    throw new Error(
      `x402_config_invalid: resource URL is empty. ` +
      `Set NEXT_PUBLIC_APP_URL or REPODIET_APP_URL to the canonical production origin.`
    );
  }
  if (!isValidHttpsUrl(resourceUrl)) {
    throw new Error(
      `x402_config_invalid: resource URL "${resourceUrl}" must be an HTTPS URL. ` +
      `Set NEXT_PUBLIC_APP_URL to the canonical production origin (e.g. https://skillswap-virid-kappa.vercel.app).`
    );
  }
  if (!resourceUrl.endsWith(QUICK_TRIAGE_RESOURCE_PATH)) {
    throw new Error(
      `x402_config_invalid: resource URL "${resourceUrl}" must end with "${QUICK_TRIAGE_RESOURCE_PATH}". ` +
      `It must match the public protected endpoint exactly.`
    );
  }

  return { network, asset, amount, payTo, resourceUrl };
}

/**
 * Validate a payment-proof network/asset/payTo against production constants.
 * Returns a string describing the mismatch, or null when the proof is acceptable.
 */
export function validatePaymentProofFields(proof: {
  network?: string;
  asset?: string;
  payTo?: string;
  amount?: string;
  configuredPayTo: string;
}): string | null {
  if (proof.network && proof.network !== MAINNET_NETWORK) {
    return `payment_proof_mismatch: network "${proof.network}" is not the production network "${MAINNET_NETWORK}".`;
  }
  if (proof.asset && proof.asset.toLowerCase() !== MAINNET_USDT) {
    return `payment_proof_mismatch: asset "${proof.asset}" is not the production USD₮0 asset "${MAINNET_USDT}".`;
  }
  if (
    proof.payTo &&
    proof.payTo.toLowerCase() !== proof.configuredPayTo.toLowerCase()
  ) {
    return `payment_proof_mismatch: payTo "${proof.payTo}" does not match configured payTo.`;
  }
  if (proof.amount !== undefined && proof.amount !== QUICK_TRIAGE_AMOUNT) {
    return `payment_proof_mismatch: amount "${proof.amount}" does not match required amount "${QUICK_TRIAGE_AMOUNT}".`;
  }
  return null;
}
