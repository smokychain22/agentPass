import { getOkxReceipt } from "./store";
import { getExecutionReceipt } from "@/lib/store/product-store";

export async function verifyReceipt(receiptId: string): Promise<{
  valid: boolean;
  receipt?: Record<string, unknown>;
  reason?: string;
}> {
  const okxReceipt = await getOkxReceipt(receiptId);
  if (okxReceipt) {
    return {
      valid: Boolean(okxReceipt.signature),
      receipt: okxReceipt as unknown as Record<string, unknown>,
      reason: okxReceipt.signature ? undefined : "Receipt missing operator signature.",
    };
  }

  const legacy = await getExecutionReceipt(receiptId);
  if (legacy) {
    return {
      valid: Boolean(legacy.signature),
      receipt: legacy as unknown as Record<string, unknown>,
    };
  }

  return { valid: false, reason: "Receipt not found." };
}
