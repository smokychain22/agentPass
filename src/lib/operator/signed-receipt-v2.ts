import { createHash, createSign, createVerify } from "node:crypto";
import { getOperatorAgentId } from "@/lib/okx/operator-identity";

export const SIGNED_RECEIPT_V2 = "SignedReceiptV2" as const;

/**
 * Future paid-delivery receipt — both digests and commerce bindings are inside
 * the RSA-SHA256 canonical payload BEFORE signing.
 */
export interface SignedReceiptV2 {
  receiptVersion: typeof SIGNED_RECEIPT_V2;
  operatorId: string;
  quoteId: string;
  quoteRequestDigest: string;
  executionRequestDigest: string;
  transactionHash: string;
  paymentReference: string;
  taskId: string;
  buyer: string;
  seller: string;
  amount: string;
  amountMicro: string;
  token: string;
  network: string;
  operation: string;
  repository: string;
  resultDigest: string;
  completionTimestamp: string;
}

export function signedReceiptV2Canonical(receipt: SignedReceiptV2): string {
  return JSON.stringify({
    receiptVersion: receipt.receiptVersion,
    operatorId: receipt.operatorId,
    quoteId: receipt.quoteId,
    quoteRequestDigest: receipt.quoteRequestDigest,
    executionRequestDigest: receipt.executionRequestDigest,
    transactionHash: receipt.transactionHash,
    paymentReference: receipt.paymentReference,
    taskId: receipt.taskId,
    buyer: receipt.buyer,
    seller: receipt.seller,
    amount: receipt.amount,
    amountMicro: receipt.amountMicro,
    token: receipt.token,
    network: receipt.network,
    operation: receipt.operation,
    repository: receipt.repository,
    resultDigest: receipt.resultDigest,
    completionTimestamp: receipt.completionTimestamp,
  });
}

export function buildSignedReceiptV2(input: Omit<SignedReceiptV2, "receiptVersion" | "operatorId"> & {
  operatorId?: string;
}): SignedReceiptV2 {
  return {
    receiptVersion: SIGNED_RECEIPT_V2,
    operatorId: input.operatorId ?? getOperatorAgentId(),
    quoteId: input.quoteId,
    quoteRequestDigest: input.quoteRequestDigest,
    executionRequestDigest: input.executionRequestDigest,
    transactionHash: input.transactionHash,
    paymentReference: input.paymentReference,
    taskId: input.taskId,
    buyer: input.buyer,
    seller: input.seller,
    amount: input.amount,
    amountMicro: input.amountMicro,
    token: input.token,
    network: input.network,
    operation: input.operation,
    repository: input.repository,
    resultDigest: input.resultDigest,
    completionTimestamp: input.completionTimestamp,
  };
}

export function signSignedReceiptV2(receipt: SignedReceiptV2): {
  signedReceipt: SignedReceiptV2;
  signature: string | null;
  canonical: string;
} {
  const canonical = signedReceiptV2Canonical(receipt);
  const privateKeyPem = process.env.REPODIET_OPERATOR_PRIVATE_KEY;
  if (!privateKeyPem) {
    if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
      throw new Error("operator_receipt_signing_key_unavailable");
    }
    return { signedReceipt: receipt, signature: null, canonical };
  }
  const normalizedKey = privateKeyPem.includes("BEGIN")
    ? privateKeyPem
    : Buffer.from(privateKeyPem, "base64").toString("utf8");
  const signer = createSign("SHA256");
  signer.update(canonical);
  signer.end();
  return {
    signedReceipt: receipt,
    signature: signer.sign(normalizedKey, "base64"),
    canonical,
  };
}

export function verifySignedReceiptV2(
  receipt: SignedReceiptV2,
  signature: string,
  publicKeyPem: string
): boolean {
  const verifier = createVerify("SHA256");
  verifier.update(signedReceiptV2Canonical(receipt));
  verifier.end();
  return verifier.verify(publicKeyPem, signature, "base64");
}

export function resultDigestOf(payload: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}
