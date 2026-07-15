import { getOkxReceipt } from "./store";
import { getExecutionReceipt } from "@/lib/store/product-store";
import {
  verifyExecutionReceipt,
  verifyExecutionReceiptV1,
  type SignedReceiptV1,
} from "@/lib/operator/sign-receipt";
import {
  OPERATOR_SIGNATURE_ALGORITHM,
  publicKeyFingerprint,
  resolveOperatorPublicKeyPem,
  operatorTrustRootSource,
  trustRootUsesPrivateDerivation,
} from "@/lib/operator/trust-root";
import { getOperatorAgentId } from "./operator-identity";
import {
  ORIGINAL_RECEIPT_QUOTE_DIGEST_STATUS,
  getBindingAttestation,
  v1CanonicalSignedFields,
} from "@/lib/operator/binding-attestation";
import { PINNED_OPERATOR_PUBLIC_KEY_FINGERPRINT } from "@/lib/operator/pinned-operator-public-key";

function v1CanonicalPayload(signed: SignedReceiptV1): string {
  return JSON.stringify({
    version: signed.version,
    operator: signed.operator,
    taskId: signed.taskId,
    quoteId: signed.quoteId ?? null,
    paymentReference: signed.paymentReference ?? null,
    repository: signed.repository,
    commitSha: signed.commitSha,
    findingIds: [...signed.findingIds].sort(),
    patchHash: signed.patchHash,
    verificationHash: signed.verificationHash,
    pullRequestUrl: signed.pullRequestUrl ?? null,
    status: signed.status,
    timestamp: signed.timestamp,
  });
}

export async function verifyReceipt(receiptId: string): Promise<{
  valid: boolean;
  receiptId?: string;
  operatorId?: string;
  signatureAlgorithm?: string;
  trustRootSource?: string;
  trustRootFingerprint?: string;
  trustRootUsesPrivateDerivation?: boolean;
  quoteDigestOriginallySigned?: boolean;
  quoteDigestStatus?: string;
  originalSignedFields?: string[];
  originalSignedPayload?: string;
  bindingAttestationId?: string;
  receipt?: Record<string, unknown>;
  reason?: string;
}> {
  const publicKey = resolveOperatorPublicKeyPem();
  const trustRootSource = operatorTrustRootSource();
  const trustRootFingerprint = publicKey
    ? publicKeyFingerprint(publicKey)
    : PINNED_OPERATOR_PUBLIC_KEY_FINGERPRINT;

  const okxReceipt = await getOkxReceipt(receiptId);
  if (okxReceipt) {
    const signed = okxReceipt.signedReceipt as unknown as SignedReceiptV1 | undefined;
    const originalSignedPayload = signed ? v1CanonicalPayload(signed) : undefined;
    const originalSignedFields = signed ? v1CanonicalSignedFields(signed) : undefined;
    const quoteDigestInSigned =
      Boolean(originalSignedPayload) &&
      originalSignedPayload!.includes(
        "sha256:eaf3dbd6c09347190fd1502a25490462f5a4d519d2b1f2b77776e225449f9937"
      );
    const binding = await getBindingAttestation(receiptId);

    if (!okxReceipt.signature) {
      return {
        valid: false,
        receiptId: okxReceipt.receiptId,
        operatorId: okxReceipt.operatorAgentId || getOperatorAgentId(),
        signatureAlgorithm: OPERATOR_SIGNATURE_ALGORITHM,
        trustRootSource,
        trustRootFingerprint,
        trustRootUsesPrivateDerivation: trustRootUsesPrivateDerivation(),
        quoteDigestOriginallySigned: false,
        quoteDigestStatus: ORIGINAL_RECEIPT_QUOTE_DIGEST_STATUS,
        originalSignedFields,
        originalSignedPayload,
        bindingAttestationId: binding?.attestationId,
        receipt: okxReceipt as unknown as Record<string, unknown>,
        reason: "Receipt missing operator signature.",
      };
    }
    if (!publicKey) {
      return {
        valid: false,
        receiptId: okxReceipt.receiptId,
        operatorId: okxReceipt.operatorAgentId || getOperatorAgentId(),
        signatureAlgorithm: OPERATOR_SIGNATURE_ALGORITHM,
        trustRootSource,
        trustRootFingerprint,
        trustRootUsesPrivateDerivation: trustRootUsesPrivateDerivation(),
        quoteDigestOriginallySigned: quoteDigestInSigned,
        quoteDigestStatus: quoteDigestInSigned
          ? undefined
          : ORIGINAL_RECEIPT_QUOTE_DIGEST_STATUS,
        originalSignedFields,
        originalSignedPayload,
        bindingAttestationId: binding?.attestationId,
        receipt: okxReceipt as unknown as Record<string, unknown>,
        reason: "Operator receipt trust root is not configured.",
      };
    }
    if (!signed) {
      return {
        valid: false,
        receiptId: okxReceipt.receiptId,
        operatorId: okxReceipt.operatorAgentId || getOperatorAgentId(),
        signatureAlgorithm: OPERATOR_SIGNATURE_ALGORITHM,
        trustRootSource,
        trustRootFingerprint,
        trustRootUsesPrivateDerivation: trustRootUsesPrivateDerivation(),
        quoteDigestOriginallySigned: false,
        quoteDigestStatus: ORIGINAL_RECEIPT_QUOTE_DIGEST_STATUS,
        originalSignedFields,
        originalSignedPayload,
        bindingAttestationId: binding?.attestationId,
        receipt: okxReceipt as unknown as Record<string, unknown>,
        reason: "Commerce receipt lacks its signed payload and cannot be independently verified.",
      };
    }

    const valid = verifyExecutionReceiptV1(signed, okxReceipt.signature, publicKey);
    return {
      valid,
      receiptId: okxReceipt.receiptId,
      operatorId: okxReceipt.operatorAgentId || getOperatorAgentId(),
      signatureAlgorithm: OPERATOR_SIGNATURE_ALGORITHM,
      trustRootSource,
      trustRootFingerprint,
      trustRootUsesPrivateDerivation: trustRootUsesPrivateDerivation(),
      quoteDigestOriginallySigned: quoteDigestInSigned,
      quoteDigestStatus: quoteDigestInSigned
        ? undefined
        : ORIGINAL_RECEIPT_QUOTE_DIGEST_STATUS,
      originalSignedFields,
      originalSignedPayload,
      bindingAttestationId: binding?.attestationId,
      // Return receipt as stored — do not mutate historical SignedReceiptV1 or unsigned fields.
      receipt: okxReceipt as unknown as Record<string, unknown>,
      reason: valid ? undefined : "Receipt signature is invalid.",
    };
  }

  const legacy = await getExecutionReceipt(receiptId);
  if (legacy) {
    const valid = Boolean(
      legacy.signature &&
        publicKey &&
        verifyExecutionReceipt(legacy.receipt, legacy.signature, publicKey)
    );
    return {
      valid,
      receiptId,
      operatorId: getOperatorAgentId(),
      signatureAlgorithm: OPERATOR_SIGNATURE_ALGORITHM,
      trustRootSource,
      trustRootFingerprint,
      trustRootUsesPrivateDerivation: trustRootUsesPrivateDerivation(),
      receipt: legacy as unknown as Record<string, unknown>,
      reason: valid
        ? undefined
        : publicKey
          ? "Receipt signature is invalid."
          : "Operator receipt trust root is not configured.",
    };
  }

  return { valid: false, receiptId, reason: "Receipt not found." };
}
