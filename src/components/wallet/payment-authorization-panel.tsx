"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectWalletButton } from "@/components/wallet/connect-wallet-button";
import { useWallet } from "@/components/wallet/wallet-provider";
import { sendUsdtPayment } from "@/lib/wallet/erc20-transfer";
import { readErc20BalanceMicro } from "@/lib/wallet/eip1193-provider";
import { shortenAddress } from "@/lib/wallet/chain-config";
import { X402_ASSET } from "@/lib/payment/constants";
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
import { loadPersistedSession, savePersistedSession } from "@/lib/session/persist-session";

interface PaymentAuthorizationPanelProps {
  quote: WorkflowQuote;
  loading: boolean;
  /** When true, hide/disable the authorize control (scope unsafe or preview gate). */
  authorizationBlocked?: boolean;
  authorizationBlockReason?: string | null;
  /**
   * Vercel Preview / non-production: replace live wallet payment with a local simulation.
   * Must not call wallet, transfer, verify, mint write tokens, or dispatch writers.
   */
  previewDryRun?: boolean;
  onSimulateAuthorization?: () => void;
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
  previewDryRun = false,
  onSimulateAuthorization,
  onAuthorize,
}: PaymentAuthorizationPanelProps) {
  const wallet = useWallet();
  const trustedTestPayment = isTrustedTestQuote(quote);
  const { state, session, isOnXLayer, connect, switchNetwork, setPaymentState } = wallet;
  const [payerInput, setPayerInput] = useState(readStoredPayerWallet);
  const [localError, setLocalError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [simulated, setSimulated] = useState(false);
  const [usdtBalanceMicro, setUsdtBalanceMicro] = useState<bigint | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!session?.address || !isOnXLayer) {
      setUsdtBalanceMicro(null);
      setBalanceError(null);
      return;
    }
    let cancelled = false;
    void readErc20BalanceMicro({
      owner: session.address,
      tokenAddress: quote.assetContract || X402_ASSET,
    })
      .then((balance) => {
        if (!cancelled) {
          setUsdtBalanceMicro(balance);
          setBalanceError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setUsdtBalanceMicro(null);
          setBalanceError(
            err instanceof Error ? err.message : "Could not read USDT balance."
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session?.address, isOnXLayer, quote.assetContract, quote.quoteId]);

  const quoteExpired =
    Boolean(quote.expiresAt) && new Date(quote.expiresAt!).getTime() <= Date.now();
  const requiredMicro = BigInt(quote.amountMicro || "0");
  const insufficientBalance =
    usdtBalanceMicro !== null && usdtBalanceMicro < requiredMicro;

  const persistQuoteId = () => {
    const stored = loadPersistedSession();
    if (!stored) return;
    savePersistedSession({ ...stored, quoteId: quote.quoteId });
  };

  const handlePreviewSimulate = () => {
    if (authorizationBlocked) {
      setLocalError(authorizationBlockReason || "Payment authorization is blocked for this scope.");
      return;
    }
    setLocalError(null);
    setSimulated(true);
    onSimulateAuthorization?.();
  };

  const handleTestAuthorize = async () => {
    if (previewDryRun) {
      handlePreviewSimulate();
      return;
    }
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
    if (previewDryRun) {
      handlePreviewSimulate();
      return;
    }
    if (authorizationBlocked) {
      setLocalError(authorizationBlockReason || "Payment authorization is blocked for this scope.");
      return;
    }
    if (quoteExpired) {
      setLocalError("This quote expired. Generate a fresh quote, then pay again.");
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
    if (insufficientBalance) {
      setLocalError(
        `Insufficient USDT. Need ${displayAmount}; wallet balance is too low on X Layer.`
      );
      return;
    }

    try {
      const payer = normalizeWalletAddress(session.address);
      storePayerWallet(payer);
      persistQuoteId();

      // Safe retry: if a transfer was already submitted, reuse the hash — do not pay twice.
      let hash = txHash;
      if (!hash) {
        setPaymentState("signature_requested");
        const sent = await sendUsdtPayment({
          from: payer,
          to: quote.recipient,
          amountMicro: quote.amountMicro,
          tokenAddress: quote.assetContract || X402_ASSET,
          chainId: quote.chainId ?? 196,
        });
        hash = sent.txHash;
        setTxHash(hash);
      }

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
    <details className="rounded-md border border-border/40 bg-background/30 p-3 text-xs">
      <summary className="cursor-pointer font-medium text-electric">Advanced payment details</summary>
      <dl className="mt-2 grid gap-1">
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
          <dd className="font-mono">x402 / quote settlement</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Transactions</dt>
          <dd>one ERC-20 transfer (approve may be separate if allowance is zero)</dd>
        </div>
      </dl>
    </details>
  );

  if (previewDryRun) {
    return (
      <div className="mt-4 w-full space-y-3">
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-50">
          <p className="font-medium">PREVIEW — NO REAL PAYMENT OR REPOSITORY WRITE</p>
          <p className="mt-1 text-xs">
            Quoted production amount below is for inspection only. Simulation never calls a wallet,
            transfers USDT, verifies a transaction, mints a write token, or mutates GitHub.
          </p>
        </div>

        {quoteDetails}

        {authorizationBlocked && (
          <p className="text-sm text-destructive">
            {authorizationBlockReason || "Payment authorization is blocked for this cleanup scope."}
          </p>
        )}
        {localError && <p className="text-sm text-destructive">{localError}</p>}
        {simulated && (
          <p className="text-sm text-foreground">
            Simulated authorization recorded locally only — no payment, no worker, no repository write.
          </p>
        )}

        <Button
          onClick={handlePreviewSimulate}
          disabled={loading || authorizationBlocked || simulated}
        >
          {simulated ? "Simulation complete" : "Simulate authorization"}
        </Button>
      </div>
    );
  }

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

  const walletReady = Boolean(session?.address && isOnXLayer);
  const liveLabel =
    authorizationBlocked
      ? "Payment blocked — fix cleanup scope"
      : quoteExpired
        ? "Quote expired — refresh quote"
        : insufficientBalance
          ? "Insufficient USDT"
          : state === "disconnected" || state === "failed"
            ? "Connect wallet first"
            : state === "wrong_network"
              ? "Switch to X Layer first"
              : state === "connecting" || state === "switching_network"
                ? "Waiting for wallet…"
                : txHash
                  ? "Confirm submitted payment"
                  : walletReady
                    ? exact.authorizeButtonLabel
                    : "Connect wallet first";

  const canAuthorize =
    walletReady &&
    !authorizationBlocked &&
    !loading &&
    !quoteExpired &&
    !insufficientBalance &&
    state !== "payment_pending" &&
    state !== "signature_requested" &&
    state !== "connecting" &&
    state !== "switching_network";

  const balanceLabel =
    usdtBalanceMicro === null
      ? null
      : `${formatExactUsdtFromMicro(usdtBalanceMicro.toString(), {
          currency: quote.currency || "USDT",
        }).amountDisplay} ${quote.currency || "USDT"}`;

  return (
    <div className="mt-4 w-full space-y-3">
      <div className="rounded-md border border-border/50 bg-card/40 p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Pay {displayAmount} to start cleanup</p>
        <p className="mt-1">
          Connect your wallet on X Layer (chain 196). RepoDiet will request exactly{" "}
          <span className="font-mono text-foreground">{displayAmount}</span>, then verify the
          transfer on-chain before changing any files.
        </p>
        <p className="mt-2 text-xs">
          For Fix &amp; PR delivery use OKX A2A escrow (service 32947). This panel is not the
          Fix &amp; PR payment rail.
        </p>
      </div>

      {quoteDetails}

      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">1. Connect wallet</p>
        <ConnectWalletButton />
        {session && isOnXLayer && (
          <p className="font-mono text-xs text-muted-foreground">
            Ready · payer {shortenAddress(session.address)} · X Layer
            {balanceLabel ? ` · balance ${balanceLabel}` : ""}
          </p>
        )}
        {balanceError ? <p className="text-xs text-destructive">{balanceError}</p> : null}
        {insufficientBalance ? (
          <p className="text-sm text-destructive">
            Insufficient USDT for {displayAmount}. Add funds on X Layer, then try again.
          </p>
        ) : null}
        {quoteExpired ? (
          <p className="text-sm text-destructive">
            This quote expired. Use “Refresh quote” above, then authorize payment again.
          </p>
        ) : null}
        {wallet?.error && (state === "failed" || state === "wrong_network") ? (
          <p className="text-sm text-destructive">{wallet.error}</p>
        ) : null}
      </div>

      {txHash && (
        <div className="rounded-md border border-border/40 bg-background/40 p-2 text-xs">
          <p className="font-medium text-foreground">
            {state === "payment_verified" || state === "execution_started"
              ? "Payment confirmed"
              : "Payment submitted — waiting for confirmation"}
          </p>
          <p className="mt-1 font-mono text-muted-foreground">
            Tx: {txHash.slice(0, 10)}…{txHash.slice(-8)}
          </p>
        </div>
      )}

      {authorizationBlocked && (
        <p className="text-sm text-destructive">
          {authorizationBlockReason || "Payment authorization is blocked for this cleanup scope."}
        </p>
      )}
      {localError && <p className="text-sm text-destructive">{localError}</p>}

      <div className="space-y-1">
        <p className="text-xs font-medium text-foreground">2. Authorize payment</p>
        <Button
          onClick={() => {
            void handleLiveAuthorize().catch(() => undefined);
          }}
          disabled={!canAuthorize}
        >
          {loading || state === "payment_pending" || state === "signature_requested" ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {state === "signature_requested"
                ? "Confirm in wallet…"
                : state === "payment_pending"
                  ? "Payment submitted — confirming…"
                  : "Working…"}
            </>
          ) : (
            liveLabel
          )}
        </Button>
        {!walletReady && !authorizationBlocked ? (
          <p className="text-[11px] text-muted-foreground">
            The authorize button stays disabled until your wallet is connected on X Layer.
          </p>
        ) : null}
      </div>
    </div>
  );
}
