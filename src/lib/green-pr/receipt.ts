import { z } from "zod";
import { canonicalDigest } from "./canonical-json";
import type { MaintenanceContractRecord } from "./contract";
import {
  signCanonicalPayload,
  verifyCanonicalPayload,
  type AsymmetricSigner,
  type DetachedSignature,
} from "./signatures";

export interface GreenPrReceiptPayload {
  receiptVersion: "1";
  receiptId: string;
  contractDigest: string;
  aspId: number;
  serviceId: number;
  quoteId: string;
  taskId: string;
  paymentReference: string;
  repository: string;
  sourceCommit: string;
  amount: string;
  asset: string;
  network: string;
  payer: string;
  recipient: string;
  idempotencyKey: string;
  deliveryId: string;
  issuedAt: string;
}

export interface SignedGreenPrReceipt {
  payload: GreenPrReceiptPayload;
  payloadDigest: string;
  signature: DetachedSignature;
}

const receiptPayloadSchema = z.object({
  receiptVersion: z.literal("1"),
  receiptId: z.string().trim().min(1).max(200),
  contractDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  aspId: z.number().int().positive(),
  serviceId: z.number().int().positive(),
  quoteId: z.string().trim().min(1).max(200),
  taskId: z.string().trim().min(1).max(200),
  paymentReference: z.string().trim().min(1).max(500),
  repository: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  sourceCommit: z.string().regex(/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/),
  amount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/),
  asset: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  network: z.string().trim().min(1),
  payer: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  idempotencyKey: z.string().trim().min(1).max(500),
  deliveryId: z.string().trim().min(1).max(500),
  issuedAt: z.string().datetime({ offset: true }),
}).strict();

const signedReceiptSchema = z.object({
  payload: receiptPayloadSchema,
  payloadDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  signature: z.object({
    keyId: z.string().trim().min(1),
    keyVersion: z.string().trim().min(1),
    algorithm: z.enum(["ed25519", "sha256"]),
    signature: z.string().trim().min(1),
  }).strict(),
}).strict();

export function signGreenPrReceipt(
  payload: GreenPrReceiptPayload,
  signer: AsymmetricSigner
): SignedGreenPrReceipt {
  const validated = receiptPayloadSchema.parse(payload) as GreenPrReceiptPayload;
  return {
    payload: validated,
    payloadDigest: canonicalDigest(validated),
    signature: signCanonicalPayload(validated, signer),
  };
}

export function verifyGreenPrReceipt(
  receipt: SignedGreenPrReceipt,
  contractRecord: MaintenanceContractRecord,
  trustedPublicKeys: Record<string, string>,
  seenReceiptIds: Set<string> = new Set()
): { valid: boolean; duplicate: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const parsed = signedReceiptSchema.safeParse(receipt);
  if (!parsed.success) {
    return { valid: false, duplicate: false, reasons: ["receipt_payload_invalid"] };
  }
  receipt = parsed.data as SignedGreenPrReceipt;
  const contract = contractRecord.contract;
  const trustedKey = trustedPublicKeys[receipt.signature.keyId];
  if (!trustedKey || !verifyCanonicalPayload(receipt.payload, receipt.signature, trustedKey)) {
    reasons.push("receipt_signature_invalid");
  }
  if (canonicalDigest(receipt.payload) !== receipt.payloadDigest) reasons.push("receipt_digest_mismatch");
  if (receipt.payload.contractDigest !== contractRecord.contractDigest) {
    reasons.push("receipt_contract_mismatch");
  }
  if (receipt.payload.aspId !== contract.commercialTerms.aspId) reasons.push("receipt_asp_mismatch");
  if (receipt.payload.serviceId !== contract.commercialTerms.serviceId) {
    reasons.push("receipt_service_mismatch");
  }
  if (receipt.payload.quoteId !== contract.commercialTerms.quoteId) reasons.push("receipt_quote_mismatch");
  if (receipt.payload.repository !== `${contract.repository.owner}/${contract.repository.name}`) {
    reasons.push("receipt_repository_mismatch");
  }
  if (receipt.payload.sourceCommit !== contract.repository.sourceCommit) {
    reasons.push("receipt_source_commit_mismatch");
  }
  if (receipt.payload.amount !== contract.commercialTerms.amount) reasons.push("receipt_amount_mismatch");
  if (receipt.payload.asset !== contract.commercialTerms.asset) reasons.push("receipt_asset_mismatch");
  if (receipt.payload.network !== contract.commercialTerms.network) reasons.push("receipt_network_mismatch");
  if (receipt.payload.payer.toLowerCase() !== contract.commercialTerms.payer.toLowerCase()) {
    reasons.push("receipt_payer_mismatch");
  }
  if (receipt.payload.recipient.toLowerCase() !== contract.commercialTerms.recipient.toLowerCase()) {
    reasons.push("receipt_recipient_mismatch");
  }
  const duplicate = seenReceiptIds.has(receipt.payload.receiptId);
  if (duplicate) reasons.push("duplicate_receipt");
  return { valid: reasons.length === 0, duplicate, reasons };
}
