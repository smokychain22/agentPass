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

  const { state, session, connect, disconnect, switchNetwork, networkLabel } = wallet;

  if (state === "connecting" || state === "switching_network") {
    return (
      <Button size={size} variant={variant} className={className} disabled>
        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        {state === "switching_network" ? "Switching…" : "Connecting…"}
      </Button>
    );
  }

  if (state === "wrong_network") {
    return (
      <Button size={size} variant="default" className={className} onClick={() => void switchNetwork()}>
        Switch to {networkLabel}
      </Button>
    );
  }

  if (session && (state === "connected" || state === "payment_pending" || state === "payment_verified")) {
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
    <Button size={size} variant={variant} className={className} onClick={() => void connect()}>
      <Wallet className="mr-2 h-3.5 w-3.5" />
      Connect wallet
    </Button>
  );
}
