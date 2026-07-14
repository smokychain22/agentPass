"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectWalletButton } from "@/components/wallet/connect-wallet-button";
import { useWallet } from "@/components/wallet/wallet-provider";
import { sendUsdtPayment } from "@/lib/wallet/erc20-transfer";
import { shortenAddress } from "@/lib/wallet/chain-config";
import type { WorkflowQuote } from "@/lib/workflow/client";
import {
  createTestPaymentReference,
  isTrustedTestQuote,
  normalizeWalletAddress,
  readStoredPayerWallet,
  storePayerWallet,
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

/**
 * Fix & PR payment gate — always the direct website path.
 * OKX.AI marketplace customers do not pay here; they hire ASP 5283 on OKX.AI.
 */
export function PaymentAuthorizationPanel({
  quote,
  loading,
  onAuthorize,
}: PaymentAuthorizationPanelProps) {
  const wallet = useWallet();
  const trustedTestPayment = isTrustedTestQuote(quote);
  const { state, session, isOnXLayer, connect, switchNetwork, setPaymentState } = wallet;
  const [payerInput, setPayerInput] = useState(readStoredPayerWallet);
  const [localError, setLocalError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  useEffect(() => {
    const stored = readStoredPayerWallet();
    if (stored) setPayerInput(stored);
  }, []);

  useEffect(() => {
    if (session?.address) {
      setPayerInput(session.address);
    }
  }, [session?.address]);

  const handleTestAuthorize = async () => {
    setLocalError(null);
    setPaymentState("payment_pending");
    try {
      const payer = normalizeWalletAddress(payerInput || session?.address || "");
      storePayerWallet(payer);
      const paymentReference = createTestPaymentReference(quote.quoteId);
      await onAuthorize({ payer, paymentReference });
      setPaymentState("payment_verified");
    } catch (err) {
      setPaymentState(session ? "connected" : "disconnected");
      setLocalError(err instanceof Error ? err.message : "Payment authorization failed.");
      throw err;
    }
  };

  const handleLiveAuthorize = async () => {
    setLocalError(null);

    if (!session?.address) {
      await connect();
      return;
    }
    if (!isOnXLayer) {
      await switchNetwork();
      return;
    }

    setPaymentState("signature_requested");
    try {
      const payer = normalizeWalletAddress(session.address);
      storePayerWallet(payer);
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
      setPaymentState(isOnXLayer ? "connected" : "wrong_network");
      setLocalError(err instanceof Error ? err.message : "Payment authorization failed.");
      throw err;
    }
  };

  if (trustedTestPayment) {
    const canPay = Boolean(payerInput.trim());
    return (
      <div className="mt-4 w-full space-y-3">
        <div className="rounded-md border border-border/50 bg-card/40 p-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Test payment — {quote.priceLabel}</p>
          <p className="mt-1">
            Enter your buyer wallet address and start cleanup. No on-chain USDT transfer is required
            in test mode. Payment is recorded against your wallet for the receipt only.
          </p>
        </div>

        <dl className="grid gap-1 rounded-md border border-border/40 bg-background/30 p-3 text-xs">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="font-mono">{quote.priceLabel}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Network</dt>
            <dd className="font-mono">{quote.network}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Recipient (seller)</dt>
            <dd className="truncate font-mono">{quote.recipient}</dd>
          </div>
        </dl>

        <label className="block space-y-1.5 text-sm">
          <span className="text-muted-foreground">Your buyer wallet</span>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
            placeholder="0x…"
            value={payerInput}
            onChange={(e) => setPayerInput(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        {session?.address && (
          <p className="text-xs text-muted-foreground">
            Connected: {shortenAddress(session.address)} — used if the field matches.
          </p>
        )}

        {localError && <p className="text-sm text-destructive">{localError}</p>}

        <Button
          onClick={() => {
            void handleTestAuthorize().catch(() => undefined);
          }}
          disabled={loading || !canPay || state === "payment_pending"}
        >
          {loading || state === "payment_pending" ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Starting cleanup…
            </>
          ) : (
            `Pay ${quote.priceLabel} & start cleanup`
          )}
        </Button>
      </div>
    );
  }

  const liveLabel =
    state === "disconnected" || state === "failed"
      ? "Connect wallet to authorize"
      : state === "wrong_network"
        ? "Switch to X Layer"
        : session?.address && isOnXLayer
          ? "Authorize USDT payment"
          : "Review payment";

  return (
    <div className="mt-4 w-full space-y-3">
      <div className="rounded-md border border-border/50 bg-card/40 p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Authorize live payment</p>
        <p className="mt-1">
          Connect your own wallet on X Layer. It will send exactly {quote.priceLabel} to{" "}
          <span className="font-mono text-xs">{quote.recipient}</span>. RepoDiet verifies the
          Transfer on-chain before cleanup starts.
        </p>
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
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <ConnectWalletButton />
        {session && isOnXLayer && (
          <span className="font-mono text-xs text-muted-foreground">
            Payer: {shortenAddress(session.address)}
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
          void handleLiveAuthorize().catch(() => undefined);
        }}
        disabled={loading || state === "payment_pending" || state === "signature_requested"}
      >
        {loading || state === "payment_pending" || state === "signature_requested" ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {state === "signature_requested" ? "Confirm in wallet…" : "Verifying payment…"}
          </>
        ) : (
          liveLabel
        )}
      </Button>
    </div>
  );
}
