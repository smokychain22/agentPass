/** Resolve OKX / x402 env vars with official OKX naming aliases. */

import { getCanonicalOkxIdentity } from "./identity";

export function readOkxEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function payToAddress(): string {
  return getCanonicalOkxIdentity().sellerWallet;
}

export function aspAgentId(): string | undefined {
  return String(getCanonicalOkxIdentity().aspAgentId);
}

export function a2aServiceId(): string | undefined {
  return String(getCanonicalOkxIdentity().a2aServiceId);
}

export function a2mcpServiceId(): string | undefined {
  return String(getCanonicalOkxIdentity().a2mcpServiceId);
}

export function okxApiCredentials(): {
  apiKey?: string;
  secretKey?: string;
  passphrase?: string;
} {
  return {
    apiKey: readOkxEnv("OKX_API_KEY", "REPODIET_OKX_API_KEY"),
    secretKey: readOkxEnv("OKX_SECRET_KEY", "REPODIET_OKX_SECRET_KEY"),
    passphrase: readOkxEnv("OKX_PASSPHRASE", "REPODIET_OKX_PASSPHRASE"),
  };
}

export function hasOkxPaymentSdkCredentials(): boolean {
  const { apiKey, secretKey, passphrase } = okxApiCredentials();
  return Boolean(apiKey && secretKey && passphrase);
}
