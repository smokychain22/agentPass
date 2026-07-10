export type EntitlementMode = "free_beta" | "test_payment" | "live_x402";

export interface EntitlementResult {
  allowed: boolean;
  mode: EntitlementMode;
  reason?: string;
  amountMicro?: string;
  quoteId?: string;
}

export interface EntitlementContext {
  toolKey: string;
  operation?: string;
  quoteId?: string;
  request?: Request;
}
