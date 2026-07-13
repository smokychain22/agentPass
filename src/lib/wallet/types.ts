export type WalletConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "wrong_network"
  | "switching_network"
  | "signature_requested"
  | "payment_pending"
  | "payment_verified"
  | "execution_started"
  | "completed"
  | "failed";

export type CustomerExecutionMode = "direct" | "okx_marketplace";

export interface WalletSession {
  address: string;
  chainId: number;
  caip2: string;
}

export interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}
