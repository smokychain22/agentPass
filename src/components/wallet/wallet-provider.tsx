"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { isXLayerChainId, XLAYER_NETWORK_LABEL } from "@/lib/wallet/chain-config";
import {
  connectInjectedWallet,
  getInjectedProvider,
  readConnectedSession,
  switchToXLayer,
} from "@/lib/wallet/eip1193-provider";
import type { CustomerExecutionMode, WalletConnectionState, WalletSession } from "@/lib/wallet/types";

interface WalletContextValue {
  state: WalletConnectionState;
  session: WalletSession | null;
  customerMode: CustomerExecutionMode;
  error: string | null;
  networkLabel: string;
  isOnXLayer: boolean;
  setCustomerMode: (mode: CustomerExecutionMode) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
  setPaymentState: (state: WalletConnectionState) => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletConnectionState>("disconnected");
  const [session, setSession] = useState<WalletSession | null>(null);
  const [customerMode, setCustomerMode] = useState<CustomerExecutionMode>("direct");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const existing = await readConnectedSession();
      if (!existing) {
        setSession(null);
        setState("disconnected");
        return;
      }
      setSession(existing);
      setState(isXLayerChainId(existing.chainId) ? "connected" : "wrong_network");
    } catch {
      setSession(null);
      setState("disconnected");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const provider = getInjectedProvider();
    if (!provider?.on) return;

    const onAccounts = () => void refresh();
    const onChain = () => void refresh();
    provider.on("accountsChanged", onAccounts);
    provider.on("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [refresh]);

  const connect = useCallback(async () => {
    if (!getInjectedProvider()) {
      setError("No wallet detected. Install MetaMask or another browser wallet, then try again.");
      setState("failed");
      return;
    }
    setState("connecting");
    setError(null);
    try {
      const connected = await connectInjectedWallet();
      setSession(connected);
      setState(isXLayerChainId(connected.chainId) ? "connected" : "wrong_network");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet connection failed.");
      setState("failed");
      setSession(null);
    }
  }, []);

  const disconnect = useCallback(() => {
    setSession(null);
    setState("disconnected");
    setError(null);
  }, []);

  const switchNetwork = useCallback(async () => {
    setState("switching_network");
    setError(null);
    try {
      const switched = await switchToXLayer();
      setSession(switched);
      setState("connected");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not switch to X Layer.";
      setError(message);
      // Timed-out switch must leave "Switching…" — fall back to wrong_network or failed.
      setState(/timed out/i.test(message) ? "failed" : "wrong_network");
    }
  }, []);

  const setPaymentState = useCallback((next: WalletConnectionState) => {
    setState(next);
  }, []);

  const value = useMemo(
    () => ({
      state,
      session,
      customerMode,
      error,
      networkLabel: XLAYER_NETWORK_LABEL,
      isOnXLayer: Boolean(session && isXLayerChainId(session.chainId)),
      setCustomerMode,
      connect,
      disconnect,
      switchNetwork,
      setPaymentState,
    }),
    [state, session, customerMode, error, connect, disconnect, switchNetwork, setPaymentState]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used within WalletProvider.");
  }
  return ctx;
}

export function useOptionalWallet(): WalletContextValue | null {
  return useContext(WalletContext);
}
