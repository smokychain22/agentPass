import { createHash, createSign, createVerify } from "node:crypto";
import { nanoid } from "nanoid";
import { getOperatorAgentId } from "@/lib/okx/operator-identity";
import { durableNow, getDurableRecord, setDurableRecord } from "@/lib/store/durable-store";
import type { PaymentReceipt } from "@/lib/okx/types";
import type { SignedReceiptV1 } from "@/lib/operator/sign-receipt";

export const BINDING_ATTESTATION_VERSION = "SignedReceiptBindingAttestationV1" as const;

/**
 * Cryptographic amendment linking an immutable historical SignedReceiptV1 to
 * the buyer-authorized quote digest and execution binding digest.
 * This is NOT a second paid execution receipt.
 */
export interface SignedReceiptBindingAttestationV1 {
  attestationVersion: typeof BINDING_ATTESTATION_VERSION;
  originalReceiptId: string;
  originalReceiptSignatureDigest: string;
  quoteId: string;
  quoteRequestDigest: string;
  executionRequestDigest: string;
  transactionHash: string;
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
  operatorId: string;
  issuedAt: string;
}

export interface StoredBindingAttestation {
  attestationId: string;
  attestation: SignedReceiptBindingAttestationV1;
  canonical: string;
  signature: string;
  kind: "binding_attestation";
  createdAt: string;
}

export function originalReceiptSignatureDigest(signatureBase64: string): string {
  return `sha256:${createHash("sha256").update(signatureBase64, "utf8").digest("hex")}`;
}

export function bindingAttestationCanonical(
  attestation: SignedReceiptBindingAttestationV1
): string {
  return JSON.stringify({
    attestationVersion: attestation.attestationVersion,
    originalReceiptId: attestation.originalReceiptId,
    originalReceiptSignatureDigest: attestation.originalReceiptSignatureDigest,
    quoteId: attestation.quoteId,
    quoteRequestDigest: attestation.quoteRequestDigest,
    executionRequestDigest: attestation.executionRequestDigest,
    transactionHash: attestation.transactionHash,
    taskId: attestation.taskId,
    buyer: attestation.buyer,
    seller: attestation.seller,
    amount: attestation.amount,
    amountMicro: attestation.amountMicro,
    token: attestation.token,
    network: attestation.network,
    operation: attestation.operation,
    repository: attestation.repository,
    resultDigest: attestation.resultDigest,
    operatorId: attestation.operatorId,
    issuedAt: attestation.issuedAt,
  });
}

export function v1CanonicalSignedFields(signed: SignedReceiptV1): string[] {
  return [
    "version",
    "operator",
    "taskId",
    "quoteId",
    "paymentReference",
    "repository",
    "commitSha",
    "findingIds",
    "patchHash",
    "verificationHash",
    "pullRequestUrl",
    "status",
    "timestamp",
  ];
}

export function buildBindingAttestationFromReceipt(
  receipt: PaymentReceipt,
  input: {
    quoteRequestDigest: string;
    executionRequestDigest: string;
  }
): SignedReceiptBindingAttestationV1 {
  if (!receipt.signature) {
    throw new Error("original_receipt_missing_signature");
  }
  const amountMicro = receipt.amountMicro ?? "30000";
  return {
    attestationVersion: BINDING_ATTESTATION_VERSION,
    originalReceiptId: receipt.receiptId,
    originalReceiptSignatureDigest: originalReceiptSignatureDigest(receipt.signature),
    quoteId: receipt.quoteId ?? "",
    quoteRequestDigest: input.quoteRequestDigest,
    executionRequestDigest: input.executionRequestDigest,
    transactionHash: receipt.paymentReference ?? "",
    taskId: receipt.taskId,
    buyer: receipt.buyer ?? "",
    seller: receipt.seller ?? "",
    amount: (Number(amountMicro) / 1_000_000).toFixed(2),
    amountMicro,
    token: receipt.token ?? "",
    network: receipt.network ?? "",
    operation: receipt.operation ?? "",
    repository: receipt.repository ?? "",
    resultDigest: receipt.resultDigest ?? receipt.resultHash,
    operatorId: receipt.operatorAgentId || getOperatorAgentId(),
    issuedAt: durableNow(),
  };
}

export function signBindingAttestation(attestation: SignedReceiptBindingAttestationV1): {
  attestation: SignedReceiptBindingAttestationV1;
  signature: string;
  canonical: string;
} {
  const privateKeyPem = process.env.REPODIET_OPERATOR_PRIVATE_KEY;
  if (!privateKeyPem) {
    throw new Error("operator_receipt_signing_key_unavailable");
  }
  const normalizedKey = privateKeyPem.includes("BEGIN")
    ? privateKeyPem
    : Buffer.from(privateKeyPem, "base64").toString("utf8");
  const canonical = bindingAttestationCanonical(attestation);
  const signer = createSign("SHA256");
  signer.update(canonical);
  signer.end();
  return {
    attestation,
    signature: signer.sign(normalizedKey, "base64"),
    canonical,
  };
}

export function verifyBindingAttestation(
  attestation: SignedReceiptBindingAttestationV1,
  signature: string,
  publicKeyPem: string
): boolean {
  const verifier = createVerify("SHA256");
  verifier.update(bindingAttestationCanonical(attestation));
  verifier.end();
  return verifier.verify(publicKeyPem, signature, "base64");
}

function attestationStoreKey(originalReceiptId: string): string {
  return `binding_attestation_${originalReceiptId}`;
}

export async function getBindingAttestation(
  originalReceiptId: string
): Promise<StoredBindingAttestation | undefined> {
  return getDurableRecord<StoredBindingAttestation>(
    "payment_entitlements",
    attestationStoreKey(originalReceiptId)
  );
}

export async function saveBindingAttestation(
  record: StoredBindingAttestation
): Promise<void> {
  await setDurableRecord(
    "payment_entitlements",
    attestationStoreKey(record.attestation.originalReceiptId),
    record
  );
  await setDurableRecord("payment_entitlements", record.attestationId, record);
}

export async function issueBindingAttestationForReceipt(
  receipt: PaymentReceipt,
  digests: { quoteRequestDigest: string; executionRequestDigest: string }
): Promise<StoredBindingAttestation> {
  const existing = await getBindingAttestation(receipt.receiptId);
  if (existing) return existing;

  const attestation = buildBindingAttestationFromReceipt(receipt, digests);
  const signed = signBindingAttestation(attestation);
  const record: StoredBindingAttestation = {
    attestationId: `binding_attestation_${nanoid(12)}`,
    attestation: signed.attestation,
    canonical: signed.canonical,
    signature: signed.signature,
    kind: "binding_attestation",
    createdAt: durableNow(),
  };
  await saveBindingAttestation(record);
  return record;
}

/** Declares clearly that historical V1 does not include quote digests in its signed bytes. */
export const ORIGINAL_RECEIPT_QUOTE_DIGEST_STATUS =
  "ORIGINAL_RECEIPT_DOES_NOT_CRYPTOGRAPHICALLY_BIND_QUOTE_DIGEST" as const;
