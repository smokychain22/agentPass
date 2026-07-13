import type { BoundQuote } from "@/lib/payment/types";
import { resolveWorkflowSettlementMode } from "@/lib/payment/a2a-test-price";
import type { WorkflowQuote } from "./client";

export function formatWorkflowQuote(quote: BoundQuote): WorkflowQuote {
  return {
    quoteId: quote.quoteId,
    amountMicro: quote.amountMicro,
    priceLabel: quote.priceLabel,
    currency: quote.currency,
    network: quote.network,
    recipient: quote.recipient,
    expiresAt: quote.expiresAt,
    payer: quote.payer,
    paymentReference: quote.paymentReference,
    operation: quote.operation,
    repository: quote.repository,
    commitSha: quote.commitSha,
    findingIds: quote.findingIds,
    settlementMode: resolveWorkflowSettlementMode({
      operation: quote.operation,
      amountMicro: quote.amountMicro,
    }),
  };
}
