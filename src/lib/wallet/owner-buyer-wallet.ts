/**
 * OKX Agentic Wallet buyer address for officialsmokychain@gmail.com.
 * Used as the default test-mode payer on Fix & PR (no on-chain transfer in trusted test quotes).
 * Override with NEXT_PUBLIC_REPODIET_OWNER_BUYER_WALLET when needed.
 */
export const REPODIET_OWNER_BUYER_WALLET =
  process.env.NEXT_PUBLIC_REPODIET_OWNER_BUYER_WALLET?.trim() ||
  "0xaa895234c3fc31c40018eef975db6ac79bf87f1a";
