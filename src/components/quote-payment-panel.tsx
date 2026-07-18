"use client";

import type { DynamicSignedQuote, PaymentChannelChoice } from "@/lib/user-directed/types";

type Props = {
  quote: DynamicSignedQuote | null;
  loading: boolean;
  error: string | null;
  channel: PaymentChannelChoice | null;
  onChannelChange: (channel: PaymentChannelChoice) => void;
  onCreateQuote: () => void;
  onAuthorize: () => void;
  authorizing: boolean;
  canQuote: boolean;
};

export function QuotePaymentPanel({
  quote,
  loading,
  error,
  channel,
  onChannelChange,
  onCreateQuote,
  onAuthorize,
  authorizing,
  canQuote,
}: Props) {
  return (
    <section className="space-y-4 rounded-md border border-border/50 bg-card/30 p-4" aria-label="Quote and payment">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Quote & Payment</p>
          <h2 className="mt-1 text-lg font-semibold">Dynamic scope-based quote</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Price is computed from the verified plan and exact patch — not a fixed 1.00 USDT.
            Changing selection, plan, or pinned commit invalidates the quote.
          </p>
        </div>
        <button
          type="button"
          className="rounded-md bg-electric px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
          disabled={loading || !canQuote}
          onClick={onCreateQuote}
        >
          {loading ? "Pricing…" : "Refresh signed quote"}
        </button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!quote ? (
        <p className="text-sm text-muted-foreground">
          Generate an exact patch preview first. No payable quote exists without a real patch.
        </p>
      ) : (
        <>
          <div>
            <p className="text-2xl font-semibold tracking-tight">
              {quote.amountDisplay} {quote.currency}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded border border-border/50 px-2 py-1">
                quote {quote.quoteId.slice(0, 10)}…
              </span>
              <span className="rounded border border-border/50 px-2 py-1">
                expires {new Date(quote.expiresAt).toLocaleString()}
              </span>
              <span className="rounded border border-border/50 px-2 py-1">
                plan {quote.planHash.slice(0, 10)}…
              </span>
            </div>
            {quote.marketplaceNote ? (
              <p className="mt-2 text-xs text-amber-200">{quote.marketplaceNote}</p>
            ) : null}
          </div>

          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Component</th>
                <th className="py-1 font-medium">Amount (atomic)</th>
                <th className="py-1 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {quote.components.map((c, i) => (
                <tr key={`${c.type}-${i}`} className="border-t border-border/30">
                  <td className="py-1.5">{formatComponentType(c.type)}</td>
                  <td className="py-1.5">
                    <code>{c.amountMicro}</code>
                  </td>
                  <td className="py-1.5 text-muted-foreground">{c.label}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <fieldset className="space-y-3 rounded-md border border-border/40 p-3">
            <legend className="px-1 text-sm font-medium">Payment channel</legend>
            <label className="flex cursor-pointer gap-3 text-sm">
              <input
                type="radio"
                name="payment-channel"
                checked={channel === "direct_website"}
                onChange={() => onChannelChange("direct_website")}
              />
              <span>
                <span className="font-medium">Direct website payment</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Exact scope-based price with direct-payment policy and failure/refund handling.
                  Bound to this quote and plan.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer gap-3 text-sm">
              <input
                type="radio"
                name="payment-channel"
                checked={channel === "okx_a2a_marketplace"}
                onChange={() => onChannelChange("okx_a2a_marketplace")}
              />
              <span>
                <span className="font-medium">OKX.AI A2A marketplace</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Official A2A task with negotiated/escrow amount and delivery review lifecycle.
                  Marketplace minimums are labeled separately from calculated cleanup cost.
                </span>
              </span>
            </label>
          </fieldset>

          {quote.components.some((c) => c.type === "marketplace_minimum") ? (
            <p className="text-xs text-muted-foreground">
              OKX marketplace minimum is shown as a floor — not the calculated cleanup cost.
            </p>
          ) : null}

          <button
            type="button"
            className="rounded-md bg-electric px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
            disabled={!channel || authorizing}
            onClick={onAuthorize}
          >
            {authorizing ? "Authorizing…" : "Authorize payment for this plan"}
          </button>
        </>
      )}
    </section>
  );
}

function formatComponentType(type: string): string {
  switch (type) {
    case "base_execution":
      return "Base execution";
    case "transformation_complexity":
      return "Transformation complexity";
    case "validation":
      return "Validation";
    case "path_count":
      return "Path count";
    case "marketplace_minimum":
      return "OKX marketplace minimum";
    case "negotiated_okx_amount":
      return "Negotiated OKX amount";
    default:
      return type;
  }
}
