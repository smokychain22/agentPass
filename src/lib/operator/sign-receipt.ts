import { createHash, createSign, createVerify } from "node:crypto";
import { OPERATOR_ID, RECEIPT_VERSION } from "@/lib/payment/constants";

export interface ExecutionReceipt {
  taskId: string;
  repository: string;
  commitSha: string;
  findingIds: string[];
  patchHash: string;
  verificationHash: string;
  status: "verified" | "partial" | "failed" | "review_plan" | "completed";
  paymentReference?: string;
  quoteId?: string;
  timestamp: string;
  pullRequestUrl?: string;
}

export interface SignedReceiptV1 {
  version: typeof RECEIPT_VERSION;
  operator: string;
  taskId: string;
  quoteId?: string;
  paymentReference?: string;
  repository: string;
  commitSha: string;
  findingIds: string[];
  patchHash: string;
  verificationHash: string;
  pullRequestUrl?: string;
  status: "completed" | "verified" | "partial" | "failed";
  timestamp: string;
}

function legacyCanonical(receipt: ExecutionReceipt): string {
  return JSON.stringify({
    taskId: receipt.taskId,
    repository: receipt.repository,
    commitSha: receipt.commitSha,
    findingIds: [...receipt.findingIds].sort(),
    patchHash: receipt.patchHash,
    verificationHash: receipt.verificationHash,
    status: receipt.status,
    paymentReference: receipt.paymentReference ?? null,
    quoteId: receipt.quoteId ?? null,
    timestamp: receipt.timestamp,
    pullRequestUrl: receipt.pullRequestUrl ?? null,
  });
}

function v1Canonical(receipt: SignedReceiptV1): string {
  return JSON.stringify({
    version: receipt.version,
    operator: receipt.operator,
    taskId: receipt.taskId,
    quoteId: receipt.quoteId ?? null,
    paymentReference: receipt.paymentReference ?? null,
    repository: receipt.repository,
    commitSha: receipt.commitSha,
    findingIds: [...receipt.findingIds].sort(),
    patchHash: receipt.patchHash,
    verificationHash: receipt.verificationHash,
    pullRequestUrl: receipt.pullRequestUrl ?? null,
    status: receipt.status,
    timestamp: receipt.timestamp,
  });
}

export function toSignedReceiptV1(receipt: ExecutionReceipt): SignedReceiptV1 {
  return {
    version: RECEIPT_VERSION,
    operator: OPERATOR_ID,
    taskId: receipt.taskId,
    quoteId: receipt.quoteId,
    paymentReference: receipt.paymentReference,
    repository: receipt.repository,
    commitSha: receipt.commitSha,
    findingIds: receipt.findingIds,
    patchHash: receipt.patchHash,
    verificationHash: receipt.verificationHash,
    pullRequestUrl: receipt.pullRequestUrl,
    status:
      receipt.status === "verified" || receipt.status === "completed"
        ? "completed"
        : receipt.status === "partial"
          ? "partial"
          : "failed",
    timestamp: receipt.timestamp,
  };
}

export function hashPatchContent(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function hashVerification(checks: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(checks)).digest("hex")}`;
}

export function signExecutionReceipt(receipt: ExecutionReceipt): {
  receipt: ExecutionReceipt;
  signedReceipt: SignedReceiptV1;
  signature: string | null;
  signedBy: string | null;
} {
  const signedReceipt = toSignedReceiptV1(receipt);
  const privateKeyPem = process.env.REPODIET_OPERATOR_PRIVATE_KEY;
  if (!privateKeyPem) {
    if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
      throw new Error("operator_receipt_signing_key_unavailable");
    }
    return { receipt, signedReceipt, signature: null, signedBy: null };
  }

  const normalizedKey = privateKeyPem.includes("BEGIN")
    ? privateKeyPem
    : Buffer.from(privateKeyPem, "base64").toString("utf8");

  const signer = createSign("SHA256");
  signer.update(v1Canonical(signedReceipt));
  signer.end();
  const signature = signer.sign(normalizedKey, "base64");

  return {
    receipt,
    signedReceipt,
    signature,
    signedBy: OPERATOR_ID,
  };
}

export function verifyExecutionReceiptV1(
  receipt: SignedReceiptV1,
  signature: string,
  publicKeyPem: string
): boolean {
  const verifier = createVerify("SHA256");
  verifier.update(v1Canonical(receipt));
  verifier.end();
  return verifier.verify(publicKeyPem, signature, "base64");
}

export function verifyExecutionReceipt(
  receipt: ExecutionReceipt,
  signature: string,
  publicKeyPem: string
): boolean {
  const verifier = createVerify("SHA256");
  verifier.update(legacyCanonical(receipt));
  verifier.end();
  return verifier.verify(publicKeyPem, signature, "base64");
}
