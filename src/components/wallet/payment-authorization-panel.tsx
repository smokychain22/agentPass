"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectWalletButton } from "@/components/wallet/connect-wallet-button";
import { CustomerPathSelector } from "@/components/wallet/customer-path-selector";
import { useWallet } from "@/components/wallet/wallet-provider";
import type { WorkflowQuote } from "@/lib/workflow/client";
import {
  createTestPaymentReference,
  isTrustedTestQuote,
  normalizeWalletAddress,
} from "@/lib/workflow/payment-ui";

interface PaymentAuthorizationPanelProps {
  quote: WorkflowQuote;
  loading: boolean;
  onAuthorize: (input: { payer: string; paymentReference: string }) => Promise<void>;
}

export function PaymentAuthorizationPanel({
  quote,
  loading,
  onAuthorize,
}: PaymentAuthorizationPanelProps) {
  const wallet = useWallet();
  const trustedTestPayment = isTrustedTestQuote(quote);
  const { state, session, isOnXLayer, connect, switchNetwork, setPaymentState, customerMode, setCustomerMode } =
    wallet;

  const payerReady = Boolean(session?.address && isOnXLayer);
  const authorizeLabel =
    state === "disconnected" || state === "failed"
      ? "Connect wallet to authorize"
      : state === "wrong_network"
        ? "Switch to X Layer"
        : payerReady
          ? "Authorize and execute"
          : "Review payment";

  const handleAuthorize = async () => {
    if (customerMode === "okx_marketplace") return;

    if (!session?.address) {
      await connect();
      return;
    }
    if (!isOnXLayer) {
      await switchNetwork();
      return;
    }

    setPaymentState("payment_pending");
    try {
      const payer = normalizeWalletAddress(session.address);
      const paymentReference = trustedTestPayment
        ? createTestPaymentReference(quote.quoteId)
        : "";
      if (!trustedTestPayment) {
        throw new Error("Live on-chain payment from browser is not yet enabled. Use OKX.AI or test mode.");
      }
      await onAuthorize({ payer, paymentReference });
      setPaymentState("payment_verified");
    } catch (err) {
      setPaymentState(payerReady ? "connected" : "failed");
      throw err;
    }
  };

  return (
    <div className="mt-4 w-full space-y-3">
      <CustomerPathSelector mode={customerMode} onModeChange={setCustomerMode} />

      {customerMode === "direct" && (
        <>
          <div className="rounded-md border border-border/50 bg-card/40 p-3 text-sm text-muted-foreground">
            {trustedTestPayment ? (
              <>
                <p className="font-medium text-foreground">Test payment authorization</p>
                <p className="mt-1">
                  Personal A2A test price ({quote.priceLabel}). Connect your wallet on X Layer to
                  authorize. No on-chain USDT transfer is required in test mode.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-foreground">Send payment on X Layer</p>
                <p className="mt-1">
                  Send exactly {quote.priceLabel} on {quote.network} to{" "}
                  <span className="font-mono text-xs">{quote.recipient}</span>. RepoDiet verifies
                  payment server-side before execution.
                </p>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ConnectWalletButton />
            {session && isOnXLayer && (
              <span className="font-mono text-xs text-muted-foreground">
                Payer: {session.address.slice(0, 6)}…{session.address.slice(-4)}
              </span>
            )}
          </div>

          <Button
            onClick={() => {
              void handleAuthorize().catch(() => undefined);
            }}
            disabled={loading || (!trustedTestPayment && customerMode === "direct")}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing payment…
              </>
            ) : state === "wrong_network" ? (
              authorizeLabel
            ) : (
              authorizeLabel
            )}
          </Button>
        </>
      )}
    </div>
  );
}
