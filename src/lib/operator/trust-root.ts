import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { getOperatorAgentId } from "@/lib/okx/operator-identity";
import { setDurableRecord, getDurableRecord } from "@/lib/store/durable-store";
import {
  PINNED_OPERATOR_PUBLIC_KEY_FINGERPRINT,
  PINNED_OPERATOR_PUBLIC_KEY_PEM,
} from "@/lib/operator/pinned-operator-public-key";

export const OPERATOR_SIGNATURE_ALGORITHM = "RSA-SHA256";

function normalizePem(value: string): string {
  const pem = value.includes("BEGIN") ? value : Buffer.from(value, "base64").toString("utf8");
  return pem.replace(/\r\n/g, "\n").replace(/([^\n])\n?$/, "$1\n");
}

export function publicKeyFingerprint(publicKeyPem: string): string {
  const normalized = normalizePem(publicKeyPem);
  return `sha256:${createHash("sha256").update(normalized, "utf8").digest("hex")}`;
}

/** Derive SPKI public PEM from private key — local/migration utility only. Never used for production verification. */
export function deriveOperatorPublicKeyPem(privateKeyPemRaw?: string): string | undefined {
  const raw = privateKeyPemRaw ?? process.env.REPODIET_OPERATOR_PRIVATE_KEY;
  if (!raw?.trim()) return undefined;
  try {
    const privateKey = createPrivateKey(normalizePem(raw.trim()));
    return createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  } catch {
    return undefined;
  }
}

function isProductionRuntime(): boolean {
  return process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
}

/**
 * Production trust root resolution:
 * 1. REPODIET_OPERATOR_PUBLIC_KEY (preferred)
 * 2. Repo-pinned SPKI public key (independent public pin)
 *
 * Production NEVER silently derives the verifier key from REPODIET_OPERATOR_PRIVATE_KEY.
 * Private-key derivation is allowed only outside production (local/dev migration).
 */
export function resolveOperatorPublicKeyPem(): string | undefined {
  const configured = process.env.REPODIET_OPERATOR_PUBLIC_KEY?.trim();
  if (configured) return normalizePem(configured);

  if (isProductionRuntime()) {
    return normalizePem(PINNED_OPERATOR_PUBLIC_KEY_PEM);
  }

  // Local/dev convenience only.
  const derived = deriveOperatorPublicKeyPem();
  if (derived) return normalizePem(derived);
  return normalizePem(PINNED_OPERATOR_PUBLIC_KEY_PEM);
}

export function operatorTrustRootSource():
  | "public_env"
  | "pinned_constant"
  | "derived_from_private_dev_only"
  | "unavailable" {
  if (process.env.REPODIET_OPERATOR_PUBLIC_KEY?.trim()) return "public_env";
  if (isProductionRuntime()) return "pinned_constant";
  if (process.env.REPODIET_OPERATOR_PRIVATE_KEY?.trim()) return "derived_from_private_dev_only";
  return "pinned_constant";
}

export function trustRootUsesPrivateDerivation(): boolean {
  return operatorTrustRootSource() === "derived_from_private_dev_only";
}

export async function publishOperatorTrustRoot(): Promise<{
  publicKeyPem: string;
  operatorId: string;
  algorithm: string;
  source: ReturnType<typeof operatorTrustRootSource>;
  fingerprint: string;
} | null> {
  const source = operatorTrustRootSource();
  if (source === "unavailable") return null;
  const publicKeyPem = resolveOperatorPublicKeyPem();
  if (!publicKeyPem) return null;
  const fingerprint = publicKeyFingerprint(publicKeyPem);
  const record = {
    publicKeyPem,
    operatorId: getOperatorAgentId(),
    algorithm: OPERATOR_SIGNATURE_ALGORITHM,
    source,
    fingerprint,
    pinnedFingerprint: PINNED_OPERATOR_PUBLIC_KEY_FINGERPRINT,
    publishedAt: new Date().toISOString(),
  };
  await setDurableRecord("payment_entitlements", "operator_trust_root", record);
  return {
    publicKeyPem,
    operatorId: record.operatorId,
    algorithm: OPERATOR_SIGNATURE_ALGORITHM,
    source,
    fingerprint,
  };
}

export async function getPublishedOperatorTrustRoot(): Promise<
  | {
      publicKeyPem: string;
      operatorId: string;
      algorithm: string;
      source?: string;
      fingerprint?: string;
      publishedAt?: string;
    }
  | undefined
> {
  return getDurableRecord("payment_entitlements", "operator_trust_root");
}
