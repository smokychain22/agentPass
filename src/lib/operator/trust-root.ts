import { createPrivateKey, createPublicKey } from "node:crypto";
import { getOperatorAgentId } from "@/lib/okx/operator-identity";
import { setDurableRecord, getDurableRecord } from "@/lib/store/durable-store";

export const OPERATOR_SIGNATURE_ALGORITHM = "RSA-SHA256";

function normalizePem(value: string): string {
  return value.includes("BEGIN") ? value : Buffer.from(value, "base64").toString("utf8");
}

/** Derive SPKI public PEM from the configured operator private signing key. Never returns the private key. */
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

/**
 * Resolve the receipt trust-root public key.
 * Prefer REPODIET_OPERATOR_PUBLIC_KEY; fall back to deriving from the signing private key
 * so production can verify receipts even before PUBLIC_KEY is mirrored into env.
 */
export function resolveOperatorPublicKeyPem(): string | undefined {
  const configured = process.env.REPODIET_OPERATOR_PUBLIC_KEY?.trim();
  if (configured) return normalizePem(configured);
  return deriveOperatorPublicKeyPem();
}

export function operatorTrustRootSource(): "public_env" | "derived_from_private" | "unavailable" {
  if (process.env.REPODIET_OPERATOR_PUBLIC_KEY?.trim()) return "public_env";
  if (process.env.REPODIET_OPERATOR_PRIVATE_KEY?.trim()) return "derived_from_private";
  return "unavailable";
}

export async function publishOperatorTrustRoot(): Promise<{
  publicKeyPem: string;
  operatorId: string;
  algorithm: string;
  source: "public_env" | "derived_from_private";
} | null> {
  const source = operatorTrustRootSource();
  if (source === "unavailable") return null;
  const publicKeyPem = resolveOperatorPublicKeyPem();
  if (!publicKeyPem) return null;
  const record = {
    publicKeyPem,
    operatorId: getOperatorAgentId(),
    algorithm: OPERATOR_SIGNATURE_ALGORITHM,
    source,
    publishedAt: new Date().toISOString(),
  };
  await setDurableRecord("payment_entitlements", "operator_trust_root", record);
  return {
    publicKeyPem,
    operatorId: record.operatorId,
    algorithm: OPERATOR_SIGNATURE_ALGORITHM,
    source,
  };
}

export async function getPublishedOperatorTrustRoot(): Promise<
  | {
      publicKeyPem: string;
      operatorId: string;
      algorithm: string;
      source?: string;
      publishedAt?: string;
    }
  | undefined
> {
  return getDurableRecord("payment_entitlements", "operator_trust_root");
}
