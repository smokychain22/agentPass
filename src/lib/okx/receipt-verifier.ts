import { getOkxReceipt } from "./store";
import { getExecutionReceipt } from "@/lib/store/product-store";
import { verifyExecutionReceipt } from "@/lib/operator/sign-receipt";

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
    return {
      valid: false,
      receipt: okxReceipt as unknown as Record<string, unknown>,
      reason: okxReceipt.signature
        ? "Legacy commerce receipt lacks its signed payload and cannot be independently verified."
        : "Receipt missing operator signature.",
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
