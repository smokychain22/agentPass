"use client";

import { Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shortenAddress } from "@/lib/wallet/chain-config";
import { useOptionalWallet } from "./wallet-provider";

interface ConnectWalletButtonProps {
  size?: "sm" | "default";
  variant?: "default" | "secondary" | "ghost";
  className?: string;
}

export function ConnectWalletButton({
  size = "sm",
  variant = "secondary",
  className,
}: ConnectWalletButtonProps) {
  const wallet = useOptionalWallet();
  if (!wallet) return null;

  const { state, session, connect, disconnect, switchNetwork, networkLabel, error } = wallet;

  if (state === "connecting" || state === "switching_network") {
    return (
      <div className={`space-y-1 ${className ?? ""}`}>
        <Button size={size} variant={variant} disabled>
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          {state === "switching_network" ? "Switching network…" : "Connecting wallet…"}
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Approve or reject the request in your wallet. This stops automatically if it times out.
        </p>
      </div>
    );
  }

  if (state === "wrong_network") {
    return (
      <div className={`space-y-1 ${className ?? ""}`}>
        <Button size={size} variant="default" onClick={() => void switchNetwork()}>
          Switch to {networkLabel}
        </Button>
        <p className="text-[11px] text-muted-foreground">
          RepoDiet payments use X Layer (chain 196).
        </p>
      </div>
    );
  }

  if (session && (state === "connected" || state === "payment_pending" || state === "payment_verified" || state === "signature_requested" || state === "execution_started")) {
    return (
      <div className={`flex items-center gap-2 ${className ?? ""}`}>
        <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
          {shortenAddress(session.address)} · {networkLabel}
        </span>
        <Button size={size} variant="ghost" onClick={disconnect}>
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <Button size={size} variant={variant} onClick={() => void connect()}>
        <Wallet className="mr-2 h-3.5 w-3.5" />
        Connect wallet
      </Button>
      {state === "failed" && error ? (
        <p className="text-[11px] text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
