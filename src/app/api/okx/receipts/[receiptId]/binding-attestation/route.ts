import { NextResponse } from "next/server";
import { getOkxReceipt } from "@/lib/okx/store";
import {
  getBindingAttestation,
  issueBindingAttestationForReceipt,
  verifyBindingAttestation,
} from "@/lib/operator/binding-attestation";
import { resolveOperatorPublicKeyPem, publicKeyFingerprint } from "@/lib/operator/trust-root";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QUOTE_REQUEST_DIGEST =
  "sha256:eaf3dbd6c09347190fd1502a25490462f5a4d519d2b1f2b77776e225449f9937";
const EXECUTION_REQUEST_DIGEST =
  "sha256:6719e581938926354c2e06ad60fd01913729aaf964da171ae513fa3cb91a6efc";

/**
 * Issue (idempotent) or fetch a SignedReceiptBindingAttestationV1 for an immutable
 * historical receipt. This is a cryptographic amendment — not a new paid execution.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ receiptId: string }> }
) {
  const { receiptId } = await context.params;
  const existing = await getBindingAttestation(receiptId);
  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Binding attestation not found." },
      { status: 404 }
    );
  }
  const publicKey = resolveOperatorPublicKeyPem();
  const valid =
    Boolean(publicKey) &&
    verifyBindingAttestation(existing.attestation, existing.signature, publicKey!);
  return NextResponse.json({
    success: valid,
    valid,
    attestationId: existing.attestationId,
    kind: existing.kind,
    attestation: existing.attestation,
    signature: existing.signature,
    canonical: existing.canonical,
    trustRootFingerprint: publicKey ? publicKeyFingerprint(publicKey) : undefined,
  });
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ receiptId: string }> }
) {
  const { receiptId } = await context.params;
  const receipt = await getOkxReceipt(receiptId);
  if (!receipt) {
    return NextResponse.json({ success: false, error: "Receipt not found." }, { status: 404 });
  }
  if (!receipt.signature || !receipt.signedReceipt) {
    return NextResponse.json(
      { success: false, error: "Original receipt missing signature/signed payload." },
      { status: 422 }
    );
  }

  try {
    const issued = await issueBindingAttestationForReceipt(receipt, {
      quoteRequestDigest: QUOTE_REQUEST_DIGEST,
      executionRequestDigest: EXECUTION_REQUEST_DIGEST,
    });
    const publicKey = resolveOperatorPublicKeyPem();
    const valid =
      Boolean(publicKey) &&
      verifyBindingAttestation(issued.attestation, issued.signature, publicKey!);

    return NextResponse.json({
      success: valid,
      valid,
      attestationId: issued.attestationId,
      kind: issued.kind,
      alreadyExisted: false,
      attestation: issued.attestation,
      signature: issued.signature,
      canonical: issued.canonical,
      trustRootFingerprint: publicKey ? publicKeyFingerprint(publicKey) : undefined,
      note: "Binding attestation amends historical SignedReceiptV1 evidence; it is not a second execution receipt.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Attestation issuance failed.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
