import {
  decodeAttestationStatement,
  getGreenPrAttestation,
  getGreenPrReceipt,
  getMaintenanceContractByDigest,
  trustedKeyMapFromEnvironment,
  verifyGreenPrReceipt,
  verifyGreenPrAttestation,
} from "@/lib/green-pr";
import { saveAgentTask, type AgentTaskRecord } from "./task-store";

export type GreenPrVerificationOperation =
  | "verify_attestation"
  | "verify_green_pr"
  | "verify_receipt";

export function isGreenPrVerificationOperation(
  value: unknown
): value is GreenPrVerificationOperation {
  return value === "verify_attestation" ||
    value === "verify_green_pr" ||
    value === "verify_receipt";
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required.`);
  return value.trim();
}

export async function executeGreenPrVerification(
  body: unknown,
  taskId: string
): Promise<AgentTaskRecord> {
  const record = body as Record<string, unknown>;
  const operation = record.operation;
  if (!isGreenPrVerificationOperation(operation)) {
    throw new Error("operation must be verify_attestation, verify_green_pr, or verify_receipt.");
  }
  if (operation === "verify_receipt") {
    const receiptId = requiredString(record, "receiptId");
    const receipt = await getGreenPrReceipt(receiptId);
    if (!receipt) throw new Error("Green PR receipt not found.");
    const contractRecord = await getMaintenanceContractByDigest(receipt.payload.contractDigest);
    if (!contractRecord) throw new Error("Maintenance contract not found.");
    const trustedReceiptPublicKeys = trustedKeyMapFromEnvironment("RECEIPT");
    if (Object.keys(trustedReceiptPublicKeys).length === 0) {
      throw new Error("Receipt trust root is not configured.");
    }
    const result = verifyGreenPrReceipt(
      receipt,
      contractRecord,
      trustedReceiptPublicKeys
    );
    const now = new Date().toISOString();
    return saveAgentTask({
      id: taskId,
      type: "verify_patch",
      status: result.valid ? "completed" : "failed",
      repository: {
        owner: contractRecord.contract.repository.owner,
        name: contractRecord.contract.repository.name,
        branch: contractRecord.contract.repository.branch,
        commitSha: contractRecord.contract.repository.sourceCommit,
      },
      result: {
        operation,
        receiptId,
        contractDigest: contractRecord.contractDigest,
        signatureValid: !result.reasons.includes("receipt_signature_invalid"),
        duplicate: result.duplicate,
        acceptanceRecommendation: result.valid ? "ACCEPT" : "REJECT",
        reasons: result.reasons,
      },
      analyzers: {},
      limitations: [],
      receipt: {},
      error: result.valid ? undefined : result.reasons.join(", "),
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });
  }
  const attestationId = requiredString(record, "attestationId");
  const attestation = await getGreenPrAttestation(attestationId);
  if (!attestation) throw new Error("Green PR attestation not found.");
  const statement = decodeAttestationStatement(attestation);
  const contractRecord = await getMaintenanceContractByDigest(
    statement.predicate.contractDigest
  );
  if (!contractRecord) throw new Error("Maintenance contract not found.");
  const trustedPublicKeys = trustedKeyMapFromEnvironment("GREEN_PR");
  const trustedReceiptPublicKeys = trustedKeyMapFromEnvironment("RECEIPT");
  if (Object.keys(trustedPublicKeys).length === 0) {
    throw new Error("Green PR attestation trust root is not configured.");
  }

  const expectedContractDigest =
    typeof record.contractDigest === "string" ? record.contractDigest.trim() : undefined;
  if (operation === "verify_green_pr" && !expectedContractDigest) {
    throw new Error("contractDigest is required for verify_green_pr.");
  }
  if (expectedContractDigest && expectedContractDigest !== contractRecord.contractDigest) {
    throw new Error("contractDigest does not match the stored contract.");
  }

  const receipt = await getGreenPrReceipt(statement.predicate.commercialEvidence.receiptId);
  const result = verifyGreenPrAttestation(attestation, {
    contractRecord,
    trustedPublicKeys,
    expectedRepository:
      typeof record.repository === "string" ? record.repository.trim() : undefined,
    expectedSourceCommit:
      typeof record.sourceCommit === "string" ? record.sourceCommit.trim() : undefined,
    expectedPrHeadCommit:
      typeof record.prHeadCommit === "string" ? record.prHeadCommit.trim() : undefined,
    expectedPullRequestNumber:
      typeof record.pullRequestNumber === "number" ? record.pullRequestNumber : undefined,
    receipt,
    trustedReceiptPublicKeys,
  });

  const now = new Date().toISOString();
  return saveAgentTask({
    id: taskId,
    type: "verify_patch",
    status: result.valid ? "completed" : "failed",
    repository: {
      owner: contractRecord.contract.repository.owner,
      name: contractRecord.contract.repository.name,
      branch: contractRecord.contract.repository.branch,
      commitSha: contractRecord.contract.repository.sourceCommit,
    },
    result: {
      operation,
      attestationId,
      contractDigest: contractRecord.contractDigest,
      contractSatisfied: result.contractSatisfied,
      signatureValid: result.signatureValid,
      sourceCommitMatched: result.sourceCommitMatched,
      scopeRespected: result.scopeRespected,
      requiredChecksPassed: result.requiredChecksPassed,
      receiptValid: result.receiptValid,
      newDiagnostics: result.newDiagnostics,
      acceptanceRecommendation: result.acceptanceRecommendation,
      reasons: result.reasons,
    },
    analyzers: {},
    limitations: [],
    receipt: {},
    error: result.valid ? undefined : result.reasons.join(", "),
    createdAt: now,
    updatedAt: now,
    completedAt: now,
  });
}
