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

export function signGreenPrReceipt(
  payload: GreenPrReceiptPayload,
  signer: AsymmetricSigner
): SignedGreenPrReceipt {
  return {
    payload,
    payloadDigest: canonicalDigest(payload),
    signature: signCanonicalPayload(payload, signer),
  };
}

export function verifyGreenPrReceipt(
  receipt: SignedGreenPrReceipt,
  contractRecord: MaintenanceContractRecord,
  trustedPublicKeys: Record<string, string>,
  seenReceiptIds: Set<string> = new Set()
): { valid: boolean; duplicate: boolean; reasons: string[] } {
  const reasons: string[] = [];
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
