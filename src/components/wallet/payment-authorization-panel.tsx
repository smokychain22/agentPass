"use client";

import { useEffect, useMemo, useState } from "react";
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
import {
  exactChargeLabelFromMicro,
  formatExactUsdtFromMicro,
} from "@/lib/pricing/exact-amount";

interface PaymentAuthorizationPanelProps {
  quote: WorkflowQuote;
  loading: boolean;
  /** When true, hide/disable the authorize control (scope unsafe or preview gate). */
  authorizationBlocked?: boolean;
  authorizationBlockReason?: string | null;
  onAuthorize: (input: {
    payer: string;
    paymentReference: string;
    paymentSignature?: string;
  }) => Promise<void>;
}

/**
 * Fix & PR payment gate — direct website path only.
 * OKX.AI marketplace customers settle via OKX escrow, not this panel.
 */
export function PaymentAuthorizationPanel({
  quote,
  loading,
  authorizationBlocked = false,
  authorizationBlockReason = null,
  onAuthorize,
}: PaymentAuthorizationPanelProps) {
  const wallet = useWallet();
  const trustedTestPayment = isTrustedTestQuote(quote);
  const { state, session, isOnXLayer, connect, switchNetwork, setPaymentState } = wallet;
  const [payerInput, setPayerInput] = useState(readStoredPayerWallet);
  const [localError, setLocalError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const exact = useMemo(
    () => formatExactUsdtFromMicro(quote.amountMicro, { currency: quote.currency || "USDT" }),
    [quote.amountMicro, quote.currency]
  );
  const chargeLabel = exactChargeLabelFromMicro(quote.amountMicro, quote.currency || "USDT");
  // Guard: never show negotiated marketing strings as the payable amount.
  const displayAmount =
    /negotiated/i.test(quote.priceLabel) || /USD₮0/.test(quote.priceLabel)
      ? chargeLabel
      : quote.priceLabel.includes("USDT") || quote.priceLabel.includes(quote.currency)
        ? quote.priceLabel
        : chargeLabel;

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
    if (authorizationBlocked) {
      setLocalError(authorizationBlockReason || "Payment authorization is blocked for this scope.");
      return;
    }
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
    if (authorizationBlocked) {
      setLocalError(authorizationBlockReason || "Payment authorization is blocked for this scope.");
      return;
    }
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

  const quoteDetails = (
    <dl className="grid gap-1 rounded-md border border-border/40 bg-background/30 p-3 text-xs">
      <div className="flex justify-between gap-2">
        <dt className="text-muted-foreground">Exact amount</dt>
        <dd className="font-mono font-medium text-foreground">{displayAmount}</dd>
      </div>
      <div className="flex justify-between gap-2">
        <dt className="text-muted-foreground">Atomic amount</dt>
        <dd className="font-mono">
          {exact.amountMicro} (decimals {exact.decimals})
        </dd>
      </div>
      <div className="flex justify-between gap-2">
        <dt className="text-muted-foreground">Quote ID</dt>
        <dd className="font-mono">{quote.quoteId}</dd>
      </div>
      <div className="flex justify-between gap-2">
        <dt className="text-muted-foreground">Network / chain</dt>
        <dd className="font-mono">
          {quote.network}
          {quote.chainId ? ` · chainId ${quote.chainId}` : ""}
        </dd>
      </div>
      <div className="flex justify-between gap-2">
        <dt className="text-muted-foreground">Asset contract</dt>
        <dd className="truncate font-mono">{quote.assetContract ?? "USDT on quote network"}</dd>
      </div>
      <div className="flex justify-between gap-2">
        <dt className="text-muted-foreground">Recipient</dt>
        <dd className="truncate font-mono">{quote.recipient}</dd>
      </div>
      {quote.expiresAt && (
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Expires</dt>
          <dd className="font-mono">{new Date(quote.expiresAt).toLocaleString()}</dd>
        </div>
      )}
      <div className="flex justify-between gap-2">
        <dt className="text-muted-foreground">Payment model</dt>
        <dd className="font-mono">direct (not OKX escrow)</dd>
      </div>
      <div className="flex justify-between gap-2">
        <dt className="text-muted-foreground">Transactions</dt>
        <dd>one ERC-20 transfer (approve may be separate if allowance is zero)</dd>
      </div>
    </dl>
  );

  if (trustedTestPayment) {
    const canPay = Boolean(payerInput.trim()) && !authorizationBlocked;
    return (
      <div className="mt-4 w-full space-y-3">
        <div className="rounded-md border border-border/50 bg-card/40 p-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Test payment — {displayAmount}</p>
          <p className="mt-1">
            Enter your buyer wallet address and start cleanup. No on-chain USDT transfer is required
            in test mode. Payment is recorded against your wallet for the receipt only.
          </p>
        </div>

        {quoteDetails}

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

        {authorizationBlocked && (
          <p className="text-sm text-destructive">
            {authorizationBlockReason || "Payment authorization is blocked for this cleanup scope."}
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
            exact.authorizeButtonLabel
          )}
        </Button>
      </div>
    );
  }

  const liveLabel =
    authorizationBlocked
      ? "Payment blocked — fix cleanup scope"
      : state === "disconnected" || state === "failed"
        ? "Connect wallet to authorize"
        : state === "wrong_network"
          ? "Switch to X Layer"
          : session?.address && isOnXLayer
            ? exact.authorizeButtonLabel
            : "Review payment";

  return (
    <div className="mt-4 w-full space-y-3">
      <div className="rounded-md border border-border/50 bg-card/40 p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Direct X Layer payment (website channel)</p>
        <p className="mt-1">
          Connect your wallet on X Layer. It will send exactly <span className="font-mono text-foreground">{displayAmount}</span>{" "}
          to <span className="font-mono text-xs">{quote.recipient}</span>. RepoDiet verifies the
          transfer on-chain before cleanup starts.
        </p>
        <p className="mt-2 text-xs">
          This website Fix &amp; PR path is a <strong className="text-foreground">direct payment</strong> to
          RepoDiet — not OKX marketplace escrow. OKX.AI A2A (service 32947) uses a separate escrow +
          buyer-acceptance lifecycle. Direct-site funds are not automatically reversed if cleanup fails;
          see <span className="font-mono">docs/direct-site-payment-policy.md</span>.
        </p>
      </div>

      {quoteDetails}

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

      {authorizationBlocked && (
        <p className="text-sm text-destructive">
          {authorizationBlockReason || "Payment authorization is blocked for this cleanup scope."}
        </p>
      )}
      {localError && <p className="text-sm text-destructive">{localError}</p>}

      <Button
        onClick={() => {
          void handleLiveAuthorize().catch(() => undefined);
        }}
        disabled={
          loading ||
          authorizationBlocked ||
          state === "payment_pending" ||
          state === "signature_requested"
        }
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
