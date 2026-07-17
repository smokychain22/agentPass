import type { BoundQuote } from "./types";
import { getBoundQuote, updateBoundQuote } from "./payment-store";

/** Quote was marked consumed before delivery (legacy bug) — payment remains valid. */
export function isMisConsumedWithoutDelivery(quote: BoundQuote): boolean {
  return (
    quote.status === "consumed" &&
    !quote.completedReceiptId &&
    (quote.paymentStatus === "verified" || Boolean(quote.paymentReference))
  );
}

/**
 * Restore funded retryable entitlement for quotes consumed without a receipt.
 * Limited to verified-payment quotes; does not bypass unpaid quotes.
 */
export async function repairMisConsumedQuote(quoteId: string): Promise<BoundQuote | undefined> {
  const quote = await getBoundQuote(quoteId);
  if (!quote || !isMisConsumedWithoutDelivery(quote)) return quote;

  return updateBoundQuote(quoteId, {
    status: "funded",
    lifecycleStatus: "funded",
    executionState: "FAILED_RETRYABLE",
    lastFailureReason: "legacy_consumed_without_delivery",
    taskId: undefined,
  });
}
