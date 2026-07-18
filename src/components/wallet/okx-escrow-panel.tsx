"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectWalletButton } from "@/components/wallet/connect-wallet-button";
import { useWallet } from "@/components/wallet/wallet-provider";
import { shortenAddress } from "@/lib/wallet/chain-config";
import type { WorkflowQuote } from "@/lib/workflow/client";
import {
  exactChargeLabelFromMicro,
  formatExactUsdtFromMicro,
} from "@/lib/pricing/exact-amount";
import { resolveOkxAgentUrl } from "@/lib/wallet/okx-agent-url";
import { getCanonicalOkxIdentityPublic } from "@/lib/okx/identity-public";
import {
  normalizeWalletAddress,
  readStoredPayerWallet,
  storePayerWallet,
} from "@/lib/workflow/payment-ui";

interface OkxEscrowPanelProps {
  quote: WorkflowQuote;
  taskId: string;
  loading: boolean;
  authorizationBlocked?: boolean;
  authorizationBlockReason?: string | null;
  previewDryRun?: boolean;
  onSimulateAuthorization?: () => void;
  onFundEscrow: (input: {
    buyerWallet: string;
    escrowReference: string;
    okxAuthorizationReference?: string;
  }) => Promise<void>;
}

/**
 * Fix & PR payment gate — OKX A2A escrow (service 32947) only.
 * Never sends USDT directly to RepoDiet’s wallet.
 */
export function OkxEscrowPanel({
  quote,
  taskId,
  loading,
  authorizationBlocked = false,
  authorizationBlockReason = null,
  previewDryRun = false,
  onSimulateAuthorization,
  onFundEscrow,
}: OkxEscrowPanelProps) {
  const wallet = useWallet();
  const { session, isOnXLayer, state } = wallet;
  const identity = getCanonicalOkxIdentityPublic();
  const okxUrl = resolveOkxAgentUrl();
  const [buyerInput, setBuyerInput] = useState(readStoredPayerWallet);
  const [escrowReference, setEscrowReference] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [phase, setPhase] = useState<
    "awaiting_okx_authorization" | "awaiting_escrow_funding" | "submitting" | "funded"
  >("awaiting_okx_authorization");

  const exact = useMemo(
    () => formatExactUsdtFromMicro(quote.amountMicro, { currency: quote.currency || "USDT" }),
    [quote.amountMicro, quote.currency]
  );
  const chargeLabel = exactChargeLabelFromMicro(quote.amountMicro, quote.currency || "USDT");

  useEffect(() => {
    if (session?.address) setBuyerInput(session.address);
  }, [session?.address]);

  const quoteExpired =
    Boolean(quote.expiresAt) && new Date(quote.expiresAt!).getTime() <= Date.now();

  const handleSubmit = async () => {
    if (previewDryRun) {
      onSimulateAuthorization?.();
      return;
    }
    if (authorizationBlocked) {
      setLocalError(authorizationBlockReason || "Escrow authorization is blocked for this scope.");
      return;
    }
    if (quoteExpired) {
      setLocalError("This quote expired. Generate a fresh OKX A2A task quote, then fund escrow again.");
      return;
    }
    setLocalError(null);
    setPhase("submitting");
    try {
      const buyerWallet = normalizeWalletAddress(buyerInput || session?.address || "");
      storePayerWallet(buyerWallet);
      await onFundEscrow({
        buyerWallet,
        escrowReference,
        okxAuthorizationReference: `okx_a2a_${identity.a2aServiceId}_${taskId}`,
      });
      setPhase("funded");
    } catch (err) {
      setPhase("awaiting_escrow_funding");
      setLocalError(err instanceof Error ? err.message : "Could not bind OKX escrow funding.");
      throw err;
    }
  };

  if (previewDryRun) {
    return (
      <div className="mt-4 w-full space-y-3">
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-50">
          <p className="font-medium">PREVIEW — NO REAL ESCROW OR REPOSITORY WRITE</p>
          <p className="mt-1 text-xs">
            Production uses OKX A2A escrow for service {identity.a2aServiceId}. Simulation never funds
            escrow, never transfers USDT, and never mutates GitHub.
          </p>
        </div>
        <p className="text-sm text-foreground">Quoted amount for inspection: {chargeLabel}</p>
        {authorizationBlocked && (
          <p className="text-sm text-destructive">
            {authorizationBlockReason || "Authorization blocked for this cleanup scope."}
          </p>
        )}
        <Button
          onClick={() => onSimulateAuthorization?.()}
          disabled={loading || authorizationBlocked}
        >
          Simulate OKX authorization
        </Button>
      </div>
    );
  }

  const canSubmit =
    !authorizationBlocked &&
    !loading &&
    !quoteExpired &&
    phase !== "submitting" &&
    phase !== "funded" &&
    Boolean(buyerInput.trim()) &&
    escrowReference.trim().length >= 8;

  return (
    <div className="mt-4 w-full space-y-3">
      <div className="rounded-md border border-border/50 bg-card/40 p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">
          Authorize RepoDiet A2A service {identity.a2aServiceId}
        </p>
        <p className="mt-1">
          Fund OKX escrow for exactly{" "}
          <span className="font-mono text-foreground">{chargeLabel}</span>. Funds stay in OKX escrow
          while RepoDiet creates the branch, verifies cleanup, and opens the pull request. Payment
          releases only after you accept delivery.
        </p>
        <p className="mt-2 text-xs">
          Do not send USDT directly to RepoDiet. Use the official OKX A2A escrow flow.
        </p>
      </div>

      <ol className="list-inside list-decimal space-y-1 text-xs text-muted-foreground">
        <li>Authorize service {identity.a2aServiceId} (ASP {identity.aspAgentId}) on OKX.AI</li>
        <li>Fund escrow for {chargeLabel} on X Layer</li>
        <li>Paste the escrow reference below so RepoDiet can start cleanup</li>
      </ol>

      <div className="flex flex-wrap gap-2">
        {okxUrl ? (
          <Button asChild size="sm">
            <Link
              href={okxUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => setPhase("awaiting_escrow_funding")}
            >
              Open OKX.AI to authorize &amp; fund escrow
            </Link>
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Open OKX.AI and hire RepoDiet ASP {identity.aspAgentId} / A2A {identity.a2aServiceId}.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">Buyer wallet (for escrow receipt)</p>
        <ConnectWalletButton />
        <input
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
          placeholder="0x…"
          value={buyerInput}
          onChange={(e) => setBuyerInput(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {session?.address && isOnXLayer ? (
          <p className="font-mono text-xs text-muted-foreground">
            Connected · {shortenAddress(session.address)} · X Layer
          </p>
        ) : null}
      </div>

      <label className="block space-y-1.5 text-sm">
        <span className="text-muted-foreground">OKX escrow funding reference</span>
        <input
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
          placeholder="Paste escrow tx / funding reference from OKX"
          value={escrowReference}
          onChange={(e) => {
            setEscrowReference(e.target.value);
            setPhase("awaiting_escrow_funding");
          }}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      {quoteExpired ? (
        <p className="text-sm text-destructive">Quote expired — refresh the cleanup quote first.</p>
      ) : null}
      {authorizationBlocked ? (
        <p className="text-sm text-destructive">
          {authorizationBlockReason || "Escrow authorization is blocked for this cleanup scope."}
        </p>
      ) : null}
      {localError ? <p className="text-sm text-destructive">{localError}</p> : null}
      {wallet.error && (state === "failed" || state === "wrong_network") ? (
        <p className="text-sm text-destructive">{wallet.error}</p>
      ) : null}

      <Button
        onClick={() => {
          void handleSubmit().catch(() => undefined);
        }}
        disabled={!canSubmit}
      >
        {loading || phase === "submitting" ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Binding escrow &amp; starting cleanup…
          </>
        ) : phase === "funded" ? (
          "Escrow funded — cleanup starting"
        ) : (
          `Confirm escrow funded · ${exact.amountDisplay} ${exact.currency}`
        )}
      </Button>

      <details className="rounded-md border border-border/40 bg-background/30 p-3 text-xs">
        <summary className="cursor-pointer font-medium text-electric">Advanced details</summary>
        <dl className="mt-2 grid gap-1 font-mono">
          <div className="flex justify-between gap-2">
            <dt>A2A service</dt>
            <dd>{identity.a2aServiceId}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>ASP agent</dt>
            <dd>{identity.aspAgentId}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Task ID</dt>
            <dd className="truncate">{taskId}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Quote ID</dt>
            <dd className="truncate">{quote.quoteId}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Atomic amount</dt>
            <dd>{quote.amountMicro}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Payment model</dt>
            <dd>OKX A2A escrow</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}
