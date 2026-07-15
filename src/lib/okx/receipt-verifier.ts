import { getOkxReceipt, saveOkxReceipt } from "./store";
import { getExecutionReceipt } from "@/lib/store/product-store";
import {
  verifyExecutionReceipt,
  verifyExecutionReceiptV1,
  type SignedReceiptV1,
} from "@/lib/operator/sign-receipt";
import {
  OPERATOR_SIGNATURE_ALGORITHM,
  publishOperatorTrustRoot,
  resolveOperatorPublicKeyPem,
} from "@/lib/operator/trust-root";
import { getBoundQuote } from "@/lib/payment/payment-store";
import { getOperatorAgentId } from "./operator-identity";
import type { PaymentReceipt } from "./types";

async function enrichReceiptWithQuoteDigests(receipt: PaymentReceipt): Promise<PaymentReceipt> {
  if (!receipt.quoteId) return receipt;
  const quote = await getBoundQuote(receipt.quoteId);
  if (!quote?.requestHash) return receipt;

  const quoteRequestDigest = quote.requestHash;
  const priorRequestHash = receipt.requestHash;
  const executionRequestDigest =
    receipt.executionRequestDigest ??
    (priorRequestHash && priorRequestHash !== quoteRequestDigest ? priorRequestHash : undefined);

  const updated: PaymentReceipt = {
    ...receipt,
    quoteRequestDigest,
    executionRequestDigest,
    // Never silently drop the authorized quote digest — promote it as primary requestHash.
    requestHash: quoteRequestDigest,
  };

  const needsWrite =
    receipt.quoteRequestDigest !== quoteRequestDigest ||
    receipt.requestHash !== quoteRequestDigest ||
    receipt.executionRequestDigest !== executionRequestDigest;

  if (needsWrite) {
    await saveOkxReceipt(updated);
  }
  return updated;
}

export async function verifyReceipt(receiptId: string): Promise<{
  valid: boolean;
  receiptId?: string;
  operatorId?: string;
  signatureAlgorithm?: string;
  receipt?: Record<string, unknown>;
  reason?: string;
}> {
  await publishOperatorTrustRoot().catch(() => null);
  const publicKey = resolveOperatorPublicKeyPem();

  const okxReceiptRaw = await getOkxReceipt(receiptId);
  if (okxReceiptRaw) {
    const okxReceipt = await enrichReceiptWithQuoteDigests(okxReceiptRaw);
    if (!okxReceipt.signature) {
      return {
        valid: false,
        receiptId: okxReceipt.receiptId,
        operatorId: okxReceipt.operatorAgentId || getOperatorAgentId(),
        signatureAlgorithm: OPERATOR_SIGNATURE_ALGORITHM,
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
        receipt: okxReceipt as unknown as Record<string, unknown>,
        reason: "Operator receipt trust root is not configured.",
      };
    }
    if (!okxReceipt.signedReceipt) {
      return {
        valid: false,
        receiptId: okxReceipt.receiptId,
        operatorId: okxReceipt.operatorAgentId || getOperatorAgentId(),
        signatureAlgorithm: OPERATOR_SIGNATURE_ALGORITHM,
        receipt: okxReceipt as unknown as Record<string, unknown>,
        reason: "Commerce receipt lacks its signed payload and cannot be independently verified.",
      };
    }
    const valid = verifyExecutionReceiptV1(
      okxReceipt.signedReceipt as unknown as SignedReceiptV1,
      okxReceipt.signature,
      publicKey
    );
    return {
      valid,
      receiptId: okxReceipt.receiptId,
      operatorId: okxReceipt.operatorAgentId || getOperatorAgentId(),
      signatureAlgorithm: OPERATOR_SIGNATURE_ALGORITHM,
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
