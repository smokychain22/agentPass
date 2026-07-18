import type { BoundQuote } from "@/lib/payment/types";
import { resolveWorkflowSettlementMode } from "@/lib/payment/a2a-test-price";
import { exactChargeLabelFromMicro } from "@/lib/pricing/exact-amount";
import type { WorkflowQuote } from "./client";

export function formatWorkflowQuote(quote: BoundQuote): WorkflowQuote {
  // Buyer-facing charge label must always be the exact numeric amount from amountMicro.
  const priceLabel = exactChargeLabelFromMicro(quote.amountMicro, quote.currency || "USDT");
  const chainId = Number(String(quote.network).split(":")[1] || "196");
  return {
    quoteId: quote.quoteId,
    amountMicro: quote.amountMicro,
    priceLabel,
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
    // Website Fix & PR uses direct ERC-20 settlement. OKX marketplace escrow is a separate channel.
    paymentModel: "direct",
    assetContract: quote.asset,
    chainId: Number.isFinite(chainId) ? chainId : 196,
  };
}
