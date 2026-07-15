import { NextResponse } from "next/server";
import { verifyReceipt } from "@/lib/okx/receipt-verifier";
import {
  getBindingAttestation,
  verifyBindingAttestation,
} from "@/lib/operator/binding-attestation";
import { resolveOperatorPublicKeyPem } from "@/lib/operator/trust-root";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ receiptId: string }> }
) {
  const { receiptId } = await context.params;
  const result = await verifyReceipt(receiptId);
  const binding = await getBindingAttestation(receiptId);
  const publicKey = resolveOperatorPublicKeyPem();
  const bindingValid =
    Boolean(binding && publicKey) &&
    verifyBindingAttestation(binding!.attestation, binding!.signature, publicKey!);

  const body = {
    success: result.valid,
    valid: result.valid,
    receiptId: result.receiptId ?? receiptId,
    operatorId: result.operatorId,
    signatureAlgorithm: result.signatureAlgorithm,
    trustRootSource: result.trustRootSource,
    trustRootFingerprint: result.trustRootFingerprint,
    trustRootUsesPrivateDerivation: result.trustRootUsesPrivateDerivation === true,
    quoteDigestOriginallySigned: result.quoteDigestOriginallySigned === true,
    quoteDigestStatus: result.quoteDigestStatus,
    originalSignedFields: result.originalSignedFields,
    originalSignedPayload: result.originalSignedPayload,
    bindingAttestation: binding
      ? {
          attestationId: binding.attestationId,
          kind: binding.kind,
          valid: bindingValid,
          attestation: binding.attestation,
          signature: binding.signature,
          canonical: binding.canonical,
        }
      : null,
    receipt: result.receipt,
    error: result.valid ? undefined : result.reason ?? "Invalid receipt.",
    futureReceiptVersion: "SignedReceiptV2",
  };

  return NextResponse.json(body, {
    status: result.valid ? 200 : result.reason === "Receipt not found." ? 404 : 422,
  });
}
