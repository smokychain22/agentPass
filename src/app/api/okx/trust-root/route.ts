import { NextResponse } from "next/server";
import {
  OPERATOR_SIGNATURE_ALGORITHM,
  operatorTrustRootSource,
  publishOperatorTrustRoot,
  publicKeyFingerprint,
  resolveOperatorPublicKeyPem,
  trustRootUsesPrivateDerivation,
} from "@/lib/operator/trust-root";
import { getOperatorAgentId } from "@/lib/okx/operator-identity";
import {
  PINNED_OPERATOR_PUBLIC_KEY_FINGERPRINT,
  PINNED_OPERATOR_PUBLIC_KEY_PEM,
} from "@/lib/operator/pinned-operator-public-key";

export const runtime = "nodejs";

/**
 * Public trust-root material for independent receipt verification.
 * Exposes only the SPKI public key — never the private signing key.
 */
export async function GET() {
  const published = await publishOperatorTrustRoot();
  const publicKeyPem = published?.publicKeyPem ?? resolveOperatorPublicKeyPem();
  if (!publicKeyPem) {
    return NextResponse.json(
      {
        success: false,
        configured: false,
        error: "Operator receipt trust root is not configured.",
        dashboardAction: [
          "Vercel → Project Settings → Environment Variables",
          "Add REPODIET_OPERATOR_PUBLIC_KEY for Production",
          "Paste the SPKI public PEM (from this endpoint after pin deploy, or pinned constant)",
          "Redeploy Production",
        ],
      },
      { status: 503 }
    );
  }

  const fingerprint = publicKeyFingerprint(publicKeyPem);
  return NextResponse.json({
    success: true,
    configured: true,
    operatorId: published?.operatorId ?? getOperatorAgentId(),
    algorithm: OPERATOR_SIGNATURE_ALGORITHM,
    source: published?.source ?? operatorTrustRootSource(),
    fingerprint,
    pinnedFingerprint: PINNED_OPERATOR_PUBLIC_KEY_FINGERPRINT,
    fingerprintMatchesPinned: fingerprint === PINNED_OPERATOR_PUBLIC_KEY_FINGERPRINT,
    trustRootUsesPrivateDerivation: trustRootUsesPrivateDerivation(),
    publicKeyPem,
    pinnedPublicKeyPem: PINNED_OPERATOR_PUBLIC_KEY_PEM,
    envHint:
      "Set REPODIET_OPERATOR_PUBLIC_KEY (Production) to this exact SPKI PEM. Production verification does not derive the public key from REPODIET_OPERATOR_PRIVATE_KEY.",
    dashboardAction: [
      "Vercel → Project Settings → Environment Variables",
      "Key: REPODIET_OPERATOR_PUBLIC_KEY",
      "Environment: Production",
      "Value: paste the SPKI public PEM below",
      "Save → Redeploy Production",
    ],
  });
}
