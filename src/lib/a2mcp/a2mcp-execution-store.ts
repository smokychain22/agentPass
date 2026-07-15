import { durableNow, getDurableRecord, setDurableRecord } from "@/lib/store/durable-store";

export interface A2mcpCompletedExecution {
  quoteId: string;
  requestHash: string;
  taskId: string;
  receiptId?: string;
  httpStatus: number;
  responseBody: Record<string, unknown>;
  resultDigest: string;
  completedAt: string;
}

function cacheKey(quoteId: string, requestHash: string): string {
  return `a2mcp_exec_${quoteId}_${requestHash}`;
}

export async function saveCompletedA2mcpExecution(
  record: A2mcpCompletedExecution
): Promise<void> {
  await setDurableRecord("payment_entitlements", cacheKey(record.quoteId, record.requestHash), record);
  await setDurableRecord("payment_entitlements", `a2mcp_quote_${record.quoteId}`, record);
}

export async function getCompletedA2mcpExecution(
  quoteId: string,
  requestHash: string
): Promise<A2mcpCompletedExecution | undefined> {
  return getDurableRecord<A2mcpCompletedExecution>(
    "payment_entitlements",
    cacheKey(quoteId, requestHash)
  );
}

export async function getCompletedA2mcpExecutionByQuote(
  quoteId: string
): Promise<A2mcpCompletedExecution | undefined> {
  return getDurableRecord<A2mcpCompletedExecution>("payment_entitlements", `a2mcp_quote_${quoteId}`);
}

export function newCompletedExecution(
  input: Omit<A2mcpCompletedExecution, "completedAt">
): A2mcpCompletedExecution {
  return { ...input, completedAt: durableNow() };
}
