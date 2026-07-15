import { NextResponse } from "next/server";
import {
  OPERATOR_SIGNATURE_ALGORITHM,
  operatorTrustRootSource,
  publishOperatorTrustRoot,
  resolveOperatorPublicKeyPem,
} from "@/lib/operator/trust-root";
import { getOperatorAgentId } from "@/lib/okx/operator-identity";

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
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    success: true,
    configured: true,
    operatorId: published?.operatorId ?? getOperatorAgentId(),
    algorithm: OPERATOR_SIGNATURE_ALGORITHM,
    source: published?.source ?? operatorTrustRootSource(),
    publicKeyPem,
    envHint:
      "Set REPODIET_OPERATOR_PUBLIC_KEY to this exact PEM (or its base64 encoding) for independent verify hosts.",
  });
}
