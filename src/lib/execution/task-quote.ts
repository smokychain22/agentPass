import { createHash, randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import { quoteCleanupPrPrice } from "@/lib/pricing/quote";

export type TaskOperation =
  | "free_proof"
  | "quick_cleanup"
  | "verified_cleanup_pr"
  | "repo_guard";

export interface TaskQuote {
  quoteId: string;
  nonce: string;
  repository: string;
  branch: string;
  commitSha: string;
  findingIds: string[];
  operation: TaskOperation;
  priceMicro: string;
  priceLabel: string;
  expiresAt: string;
  bindingHash: string;
}

const QUOTE_TTL_MS = 15 * 60 * 1000;

function hashBinding(parts: Record<string, string | string[]>): string {
  const payload = JSON.stringify(parts);
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

export function createTaskQuote(input: {
  repository: string;
  branch: string;
  commitSha: string;
  findingIds: string[];
  operation: TaskOperation;
  sourceFileCount?: number;
}): TaskQuote {
  const quoteId = `quote_${nanoid(12)}`;
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString();

  let priceMicro: string;
  let priceLabel: string;

  switch (input.operation) {
    case "free_proof":
      priceMicro = "0";
      priceLabel = "Free";
      break;
    case "quick_cleanup":
      priceMicro = "250000";
      priceLabel = "0.25 USDT";
      break;
    case "verified_cleanup_pr": {
      const pr = quoteCleanupPrPrice(input.sourceFileCount ?? 200);
      priceMicro = pr.amountMicro;
      priceLabel = `${pr.amountUsdt} USDT`;
      break;
    }
    case "repo_guard":
      priceMicro = "4000000";
      priceLabel = "4 USDT/month (launch)";
      break;
    default:
      priceMicro = "0";
      priceLabel = "Free";
  }

  const bindingHash = hashBinding({
    repository: input.repository,
    branch: input.branch,
    commitSha: input.commitSha,
    findingIds: [...input.findingIds].sort(),
    operation: input.operation,
    nonce,
    priceMicro,
    expiresAt,
  });

  return {
    quoteId,
    nonce,
    repository: input.repository,
    branch: input.branch,
    commitSha: input.commitSha,
    findingIds: input.findingIds,
    operation: input.operation,
    priceMicro,
    priceLabel,
    expiresAt,
    bindingHash,
  };
}

export function validateTaskQuote(
  quote: TaskQuote,
  input: {
    repository: string;
    branch: string;
    commitSha: string;
    findingIds: string[];
    operation: TaskOperation;
  }
): { ok: boolean; reason?: string } {
  if (new Date(quote.expiresAt).getTime() < Date.now()) {
    return { ok: false, reason: "Quote expired." };
  }
  if (quote.repository !== input.repository) {
    return { ok: false, reason: "Repository mismatch." };
  }
  if (quote.branch !== input.branch) {
    return { ok: false, reason: "Branch mismatch." };
  }
  if (quote.commitSha !== input.commitSha) {
    return { ok: false, reason: "Commit SHA mismatch — repository changed since quote." };
  }
  if (quote.operation !== input.operation) {
    return { ok: false, reason: "Operation mismatch." };
  }
  const quotedIds = [...quote.findingIds].sort().join(",");
  const inputIds = [...input.findingIds].sort().join(",");
  if (quotedIds !== inputIds) {
    return { ok: false, reason: "Finding selection mismatch." };
  }
  return { ok: true };
}
