import { createHash, createSign, createVerify } from "node:crypto";

export interface ExecutionReceipt {
  taskId: string;
  repository: string;
  commitSha: string;
  findingIds: string[];
  patchHash: string;
  verificationHash: string;
  status: "verified" | "partial" | "failed" | "review_plan";
  paymentReference?: string;
  quoteId?: string;
  timestamp: string;
}

function canonicalPayload(receipt: ExecutionReceipt): string {
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
  });
}

export function hashPatchContent(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function hashVerification(checks: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(checks)).digest("hex")}`;
}

export function signExecutionReceipt(receipt: ExecutionReceipt): {
  receipt: ExecutionReceipt;
  signature: string | null;
  signedBy: string | null;
} {
  const privateKeyPem = process.env.REPODIET_OPERATOR_PRIVATE_KEY;
  if (!privateKeyPem) {
    return { receipt, signature: null, signedBy: null };
  }

  const normalizedKey = privateKeyPem.includes("BEGIN")
    ? privateKeyPem
    : Buffer.from(privateKeyPem, "base64").toString("utf8");

  const signer = createSign("SHA256");
  signer.update(canonicalPayload(receipt));
  signer.end();
  const signature = signer.sign(normalizedKey, "base64");

  return {
    receipt,
    signature,
    signedBy: "repodiet-operator",
  };
}

export function verifyExecutionReceipt(
  receipt: ExecutionReceipt,
  signature: string,
  publicKeyPem: string
): boolean {
  const verifier = createVerify("SHA256");
  verifier.update(canonicalPayload(receipt));
  verifier.end();
  return verifier.verify(publicKeyPem, signature, "base64");
}
