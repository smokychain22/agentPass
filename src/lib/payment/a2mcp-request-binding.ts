import { createHash } from "node:crypto";

const PAYMENT_ENVELOPE_FIELDS = new Set([
  "quoteId",
  "paymentReference",
  "payer",
  "idempotencyKey",
  "paymentSignature",
  "amountMicro",
  "nonce",
]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .filter((key) => !PAYMENT_ENVELOPE_FIELDS.has(key))
      .sort()
      .map((key) => [key, canonicalize(record[key])])
  );
}

export function canonicalA2mcpPayload(body: Record<string, unknown>): string {
  return JSON.stringify(canonicalize(body));
}

export function a2mcpPayloadHash(body: Record<string, unknown>): string {
  return `sha256:${createHash("sha256").update(canonicalA2mcpPayload(body)).digest("hex")}`;
}

export function canonicalRequestResource(requestUrl: string): string {
  const url = new URL(requestUrl);
  url.search = "";
  url.hash = "";
  return url.toString();
}
