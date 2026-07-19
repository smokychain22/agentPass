/**
 * Preview cryptographic signing is allowed only for explicit X Layer Testnet canaries.
 * Ordinary Preview deployments remain unsigned dry-run.
 */
import {
  getPaymentEnvironment,
  TESTNET_USDT,
  TESTNET_CHAIN_ID,
  TESTNET_NETWORK,
} from "@/lib/payment/payment-environment";

export function isSafePreviewTestnetSigning(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if ((env.VERCEL_ENV || "").toLowerCase() !== "preview") return false;
  if (env.REPODIET_FORCE_PREVIEW_DRY_RUN === "1") return false;
  const pe = getPaymentEnvironment(env);
  if (pe.productionTestnetMisconfig) return false;
  if (pe.mainnetBlocked) return false;
  if (pe.paymentMode !== "testnet" || !pe.isTestnet) return false;
  if (pe.network !== TESTNET_NETWORK) return false;
  if (pe.chainId !== TESTNET_CHAIN_ID) return false;
  if (pe.asset !== TESTNET_USDT) return false;
  return true;
}

export function previewSigningDeniedReason(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if ((env.VERCEL_ENV || "").toLowerCase() !== "preview") return null;
  if (isSafePreviewTestnetSigning(env)) return null;
  return "preview_dry_run_unsigned";
}
