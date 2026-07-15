import { getOkxReceipt } from "./store";
import { getExecutionReceipt } from "@/lib/store/product-store";
import {
  verifyExecutionReceipt,
  verifyExecutionReceiptV1,
  type SignedReceiptV1,
} from "@/lib/operator/sign-receipt";

function operatorPublicKey(): string | undefined {
  const value = process.env.REPODIET_OPERATOR_PUBLIC_KEY;
  if (!value) return undefined;
  return value.includes("BEGIN") ? value : Buffer.from(value, "base64").toString("utf8");
}

export async function verifyReceipt(receiptId: string): Promise<{
  valid: boolean;
  receipt?: Record<string, unknown>;
  reason?: string;
}> {
  const okxReceipt = await getOkxReceipt(receiptId);
  if (okxReceipt) {
    const publicKey = operatorPublicKey();
    if (!okxReceipt.signature) {
      return {
        valid: false,
        receipt: okxReceipt as unknown as Record<string, unknown>,
        reason: "Receipt missing operator signature.",
      };
    }
    if (!publicKey) {
      return {
        valid: false,
        receipt: okxReceipt as unknown as Record<string, unknown>,
        reason: "Operator receipt trust root is not configured.",
      };
    }
    if (!okxReceipt.signedReceipt) {
      return {
        valid: false,
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
      receipt: okxReceipt as unknown as Record<string, unknown>,
      reason: valid ? undefined : "Receipt signature is invalid.",
    };
  }

  const legacy = await getExecutionReceipt(receiptId);
  if (legacy) {
    const publicKey = operatorPublicKey();
    const valid = Boolean(
      legacy.signature &&
      publicKey &&
      verifyExecutionReceipt(legacy.receipt, legacy.signature, publicKey)
    );
    return {
      valid,
      receipt: legacy as unknown as Record<string, unknown>,
      reason: valid
        ? undefined
        : publicKey
          ? "Receipt signature is invalid."
          : "Operator receipt trust root is not configured.",
    };
  }

  return { valid: false, reason: "Receipt not found." };
}
