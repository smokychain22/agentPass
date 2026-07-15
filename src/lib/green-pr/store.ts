import {
  durableNow,
  getDurableRecord,
  setDurableRecord,
  setDurableRecordIfAbsent,
} from "@/lib/store/durable-store";
import {
  verifyMaintenanceContractRecord,
  type MaintenanceContractRecord,
} from "./contract";
import type { GreenPrAttestationRecord } from "./attestation";

export async function saveMaintenanceContract(
  record: MaintenanceContractRecord
): Promise<MaintenanceContractRecord> {
  const verification = verifyMaintenanceContractRecord(record);
  if (!verification.valid) throw new Error(verification.reason ?? "maintenance_contract_invalid");
  const created = await setDurableRecordIfAbsent("maintenance_contracts", record.contractId, record);
  if (!created) {
    const existing = await getMaintenanceContract(record.contractId);
    if (existing?.contractDigest !== record.contractDigest) {
      throw new Error("maintenance_contract_id_conflict");
    }
    return existing;
  }
  await setDurableRecord("maintenance_contracts", `digest_${record.contractDigest}`, record);
  return record;
}

export async function getMaintenanceContract(
  contractId: string
): Promise<MaintenanceContractRecord | undefined> {
  return getDurableRecord<MaintenanceContractRecord>("maintenance_contracts", contractId);
}

export async function getMaintenanceContractByDigest(
  digest: string
): Promise<MaintenanceContractRecord | undefined> {
  return getDurableRecord<MaintenanceContractRecord>("maintenance_contracts", `digest_${digest}`);
}

export async function acceptMaintenanceContract(
  contractId: string,
  expectedDigest: string
): Promise<MaintenanceContractRecord> {
  const existing = await getMaintenanceContract(contractId);
  if (!existing) throw new Error("maintenance_contract_not_found");
  if (existing.contractDigest !== expectedDigest) throw new Error("contract_digest_mismatch");
  if (existing.status !== "proposed" && existing.status !== "accepted") {
    throw new Error(`maintenance_contract_cannot_accept:${existing.status}`);
  }
  const { getBoundQuote } = await import("@/lib/payment/payment-store");
  const { bindQuoteToMaintenanceContract } = await import("@/lib/payment/quote-service");
  const quote = await getBoundQuote(existing.contract.commercialTerms.quoteId);
  if (!quote) throw new Error("contract_quote_not_found");
  const contract = existing.contract;
  const repository = `${contract.repository.owner}/${contract.repository.name}`;
  const contractedFindings = [...contract.scope.findingIds].sort().join(",");
  const quotedFindings = [...quote.findingIds].sort().join(",");
  const [whole, fraction = ""] = contract.commercialTerms.amount.split(".");
  const amountMicro = `${whole}${fraction.padEnd(6, "0").slice(0, 6)}`
    .replace(/^0+(?=\d)/, "");
  if (quote.operation !== "verified_cleanup_pr") throw new Error("contract_quote_operation_mismatch");
  if (quote.repository !== repository) throw new Error("contract_quote_repository_mismatch");
  if (quote.branch !== contract.repository.branch) throw new Error("contract_quote_branch_mismatch");
  if (quote.commitSha !== contract.repository.sourceCommit) {
    throw new Error("contract_quote_source_commit_mismatch");
  }
  if (quotedFindings !== contractedFindings) throw new Error("contract_quote_findings_mismatch");
  if (quote.amountMicro !== amountMicro) throw new Error("contract_quote_amount_mismatch");
  if (quote.asset.toLowerCase() !== contract.commercialTerms.asset.toLowerCase()) {
    throw new Error("contract_quote_asset_mismatch");
  }
  if (quote.network !== contract.commercialTerms.network) {
    throw new Error("contract_quote_network_mismatch");
  }
  if (quote.recipient.toLowerCase() !== contract.commercialTerms.recipient.toLowerCase()) {
    throw new Error("contract_quote_recipient_mismatch");
  }
  if (quote.expiresAt !== contract.commercialTerms.expiry) {
    throw new Error("contract_quote_expiry_mismatch");
  }
  await bindQuoteToMaintenanceContract(quote.quoteId, expectedDigest);
  const accepted: MaintenanceContractRecord = {
    ...existing,
    status: "accepted",
    updatedAt: durableNow(),
  };
  await setDurableRecord("maintenance_contracts", contractId, accepted);
  await setDurableRecord("maintenance_contracts", `digest_${expectedDigest}`, accepted);
  return accepted;
}

export async function saveGreenPrAttestation(
  record: GreenPrAttestationRecord
): Promise<GreenPrAttestationRecord> {
  const created = await setDurableRecordIfAbsent(
    "green_pr_attestations",
    record.attestationId,
    record
  );
  if (!created) {
    const existing = await getGreenPrAttestation(record.attestationId);
    if (existing?.statementDigest !== record.statementDigest) {
      throw new Error("green_pr_attestation_id_conflict");
    }
    return existing;
  }
  return record;
}

export async function getGreenPrAttestation(
  attestationId: string
): Promise<GreenPrAttestationRecord | undefined> {
  return getDurableRecord<GreenPrAttestationRecord>(
    "green_pr_attestations",
    attestationId
  );
}

export async function markMaintenanceContractDelivered(input: {
  contractId: string;
  contractDigest: string;
  pullRequestUrl: string;
  receiptId: string;
  attestationId: string;
}): Promise<MaintenanceContractRecord> {
  const existing = await getMaintenanceContract(input.contractId);
  if (!existing) throw new Error("maintenance_contract_not_found");
  if (existing.contractDigest !== input.contractDigest) throw new Error("contract_digest_mismatch");
  if (existing.status !== "accepted" && existing.status !== "executing" &&
      existing.status !== "delivered") {
    throw new Error(`maintenance_contract_cannot_deliver:${existing.status}`);
  }
  const deliveredAt = existing.delivery?.deliveredAt ?? durableNow();
  const delivered: MaintenanceContractRecord = {
    ...existing,
    status: "delivered",
    delivery: {
      pullRequestUrl: input.pullRequestUrl,
      receiptId: input.receiptId,
      attestationId: input.attestationId,
      deliveredAt,
    },
    updatedAt: durableNow(),
  };
  await setDurableRecord("maintenance_contracts", existing.contractId, delivered);
  await setDurableRecord("maintenance_contracts", `digest_${existing.contractDigest}`, delivered);
  return delivered;
}
