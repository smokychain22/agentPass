import { NextResponse } from "next/server";
import {
  publicVerificationKeysFromEnvironment,
  type PublicVerificationKey,
} from "@/lib/green-pr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicKey(key: PublicVerificationKey, use: "receipt" | "green-pr-attestation") {
  return { use, ...key };
}

export async function GET() {
  try {
    const receiptKeys = publicVerificationKeysFromEnvironment("RECEIPT")
      .map((key) => publicKey(key, "receipt"));
    const attestationKeys = publicVerificationKeysFromEnvironment("GREEN_PR")
      .map((key) => publicKey(key, "green-pr-attestation"));
    const keys = [...receiptKeys, ...attestationKeys];
    const activeReceipt = receiptKeys.find((key) => key.active);
    const activeAttestation = attestationKeys.find((key) => key.active);
    const separated = Boolean(
      activeReceipt &&
      activeAttestation &&
      activeReceipt.keyId !== activeAttestation.keyId &&
      activeReceipt.fingerprint !== activeAttestation.fingerprint
    );

    if (!activeReceipt || !activeAttestation || !separated) {
      return NextResponse.json(
        {
          success: false,
          error: "Production verification identities are missing or not separated.",
          keys,
          separationOfPowers: separated,
        },
        { status: 503, headers: { "Cache-Control": "public, max-age=60" } }
      );
    }

    return NextResponse.json(
      {
        success: true,
        issuer: "RepoDiet Green PR Protocol",
        schema: "repodiet.keys/v1",
        separationOfPowers: true,
        keys,
      },
      { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Key registry is invalid.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
