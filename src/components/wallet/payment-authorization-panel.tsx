"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectWalletButton } from "@/components/wallet/connect-wallet-button";
import { CustomerPathSelector } from "@/components/wallet/customer-path-selector";
import { useWallet } from "@/components/wallet/wallet-provider";
import { sendUsdtPayment } from "@/lib/wallet/erc20-transfer";
import type { WorkflowQuote } from "@/lib/workflow/client";
import {
  createTestPaymentReference,
  isTrustedTestQuote,
  normalizeWalletAddress,
} from "@/lib/workflow/payment-ui";

interface PaymentAuthorizationPanelProps {
  quote: WorkflowQuote;
  loading: boolean;
  onAuthorize: (input: {
    payer: string;
    paymentReference: string;
    paymentSignature?: string;
  }) => Promise<void>;
}

export function PaymentAuthorizationPanel({
  quote,
  loading,
  onAuthorize,
}: PaymentAuthorizationPanelProps) {
  const wallet = useWallet();
  const trustedTestPayment = isTrustedTestQuote(quote);
  const {
    state,
    session,
    isOnXLayer,
    connect,
    switchNetwork,
    setPaymentState,
    customerMode,
    setCustomerMode,
  } = wallet;
  const [localError, setLocalError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const payerReady = Boolean(session?.address && isOnXLayer);
  const authorizeLabel =
    state === "disconnected" || state === "failed"
      ? "Connect wallet to authorize"
      : state === "wrong_network"
        ? "Switch to X Layer"
        : !payerReady
          ? "Review payment"
          : trustedTestPayment
            ? "Authorize and execute"
            : "Authorize USDT payment";

  const handleAuthorize = async () => {
    if (customerMode === "okx_marketplace") return;
    setLocalError(null);

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

      if (trustedTestPayment) {
        const paymentReference = createTestPaymentReference(quote.quoteId);
        await onAuthorize({ payer, paymentReference });
        setPaymentState("payment_verified");
        return;
      }

      // Live direct path: customer signs ERC-20 USDT transfer from their own wallet.
      setPaymentState("signature_requested");
      const { txHash: hash } = await sendUsdtPayment({
        from: payer,
        to: quote.recipient,
        amountMicro: quote.amountMicro,
      });
      setTxHash(hash);
      setPaymentState("payment_pending");
      await onAuthorize({
        payer,
        paymentReference: hash,
        paymentSignature: "onchain:erc20_transfer",
      });
      setPaymentState("payment_verified");
    } catch (err) {
      setPaymentState(payerReady ? "connected" : "failed");
      setLocalError(err instanceof Error ? err.message : "Payment authorization failed.");
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
                <p className="font-medium text-foreground">Authorize live payment</p>
                <p className="mt-1">
                  Your wallet will send exactly {quote.priceLabel} USDT on X Layer to{" "}
                  <span className="font-mono text-xs">{quote.recipient}</span>. RepoDiet verifies
                  the Transfer on-chain before execution starts. Price and recipient come from the
                  server quote — they cannot be edited in the browser.
                </p>
              </>
            )}
          </div>

          <dl className="grid gap-1 rounded-md border border-border/40 bg-background/30 p-3 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Quote</dt>
              <dd className="font-mono">{quote.quoteId}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Amount</dt>
              <dd className="font-mono">{quote.priceLabel}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Network</dt>
              <dd className="font-mono">{quote.network}</dd>
            </div>
            {quote.expiresAt && (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Expires</dt>
                <dd className="font-mono">{new Date(quote.expiresAt).toLocaleString()}</dd>
              </div>
            )}
          </dl>

          <div className="flex flex-wrap items-center gap-2">
            <ConnectWalletButton />
            {session && isOnXLayer && (
              <span className="font-mono text-xs text-muted-foreground">
                Payer: {session.address.slice(0, 6)}…{session.address.slice(-4)}
              </span>
            )}
          </div>

          {txHash && (
            <p className="font-mono text-xs text-muted-foreground">
              Tx: {txHash.slice(0, 10)}…{txHash.slice(-8)}
            </p>
          )}

          {localError && <p className="text-sm text-destructive">{localError}</p>}

          <Button
            onClick={() => {
              void handleAuthorize().catch(() => undefined);
            }}
            disabled={loading || state === "payment_pending" || state === "signature_requested"}
          >
            {loading || state === "payment_pending" || state === "signature_requested" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {state === "signature_requested" ? "Confirm in wallet…" : "Verifying payment…"}
              </>
            ) : (
              authorizeLabel
            )}
          </Button>
        </>
      )}
    </div>
  );
}
