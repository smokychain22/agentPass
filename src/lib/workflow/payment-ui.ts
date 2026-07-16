import type { WorkflowQuote } from "./client";
import { REPODIET_OWNER_BUYER_WALLET } from "@/lib/wallet/owner-buyer-wallet";

const WALLET_STORAGE_KEY = "repodiet_payer_wallet";

export function isTrustedTestQuote(quote: WorkflowQuote | null | undefined): boolean {
  if (!quote) return false;
  if (process.env.NODE_ENV === "production") return false;
  return quote.settlementMode === "trusted_test";
}

export function readStoredPayerWallet(): string {
  if (typeof window === "undefined") return REPODIET_OWNER_BUYER_WALLET;
  return (
    window.localStorage.getItem(WALLET_STORAGE_KEY)?.trim() ?? REPODIET_OWNER_BUYER_WALLET
  );
}

export function storePayerWallet(wallet: string): void {
  if (typeof window === "undefined") return;
  const trimmed = wallet.trim();
  if (!trimmed) return;
  window.localStorage.setItem(WALLET_STORAGE_KEY, trimmed);
}

export function createTestPaymentReference(quoteId: string): string {
  const suffix = quoteId.replace(/[^a-f0-9]/gi, "").slice(-12) || "test";
  const stamp = Date.now().toString(16);
  const body = `${stamp}${suffix}`.replace(/[^a-f0-9]/gi, "").slice(0, 40);
  return `0x${body.padEnd(40, "0")}`;
}

export function normalizeWalletAddress(input: string): string {
  const trimmed = input.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    throw new Error("Enter a valid wallet address (0x followed by 40 hex characters).");
  }
  return trimmed;
}
