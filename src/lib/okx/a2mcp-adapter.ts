import { parseGitHubUrl } from "@/lib/github/parse-github-url";
import { getStoredFindings } from "@/lib/findings/findings-store";
import { getAgentTask } from "@/lib/a2mcp/task-store";
import type { CommerceBinding } from "./types";
import { buildCommerceBinding } from "./commerce-gateway";
import type { CommerceOperation } from "@/lib/payment/types";
import { a2mcpPayloadHash, canonicalRequestResource } from "@/lib/payment/a2mcp-request-binding";
import {
  decodeAttestationStatement,
  getGreenPrAttestation,
  getGreenPrReceipt,
  getMaintenanceContractByDigest,
} from "@/lib/green-pr";

export async function resolveBindingFromBody(
  body: Record<string, unknown>,
  operation: CommerceOperation,
  request?: { url: string; method: string }
): Promise<CommerceBinding> {
  const requestFields = request
    ? {
        resourceUrl: canonicalRequestResource(request.url),
        requestMethod: request.method.toUpperCase(),
        requestPayloadHash: a2mcpPayloadHash(body),
      }
    : {};
  const commitSha =
    typeof body.commitSha === "string" && body.commitSha.trim()
      ? body.commitSha.trim()
      : undefined;
  const scanId = typeof body.scanId === "string" ? body.scanId.trim() : undefined;
  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : undefined;
  const repoUrl = typeof body.repoUrl === "string" ? body.repoUrl.trim() : undefined;
  const branch = typeof body.branch === "string" ? body.branch.trim() : "main";
  const attestationId =
    typeof body.attestationId === "string" ? body.attestationId.trim() : undefined;
  const receiptId = typeof body.receiptId === "string" ? body.receiptId.trim() : undefined;

  if (receiptId) {
    const receipt = await getGreenPrReceipt(receiptId);
    if (!receipt) throw new Error(`Receipt not found: ${receiptId}.`);
    const contract = await getMaintenanceContractByDigest(receipt.payload.contractDigest);
    if (!contract) throw new Error("Maintenance contract not found for receipt.");
    return buildCommerceBinding({
      ...requestFields,
      operation,
      repository: `${contract.contract.repository.owner}/${contract.contract.repository.name}`,
      branch: contract.contract.repository.branch,
      commitSha: contract.contract.repository.sourceCommit,
      findingIds: [
        ...contract.contract.scope.findingIds,
        `contract:${contract.contractDigest}`,
        `receipt:${receiptId}`,
      ],
    });
  }

  if (attestationId) {
    const attestation = await getGreenPrAttestation(attestationId);
    if (!attestation) throw new Error(`Attestation not found: ${attestationId}.`);
    const statement = decodeAttestationStatement(attestation);
    const contract = await getMaintenanceContractByDigest(statement.predicate.contractDigest);
    if (!contract) throw new Error("Maintenance contract not found for attestation.");
    return buildCommerceBinding({
      ...requestFields,
      operation,
      repository: `${contract.contract.repository.owner}/${contract.contract.repository.name}`,
      branch: contract.contract.repository.branch,
      commitSha: contract.contract.repository.sourceCommit,
      findingIds: [
        ...contract.contract.scope.findingIds,
        `contract:${contract.contractDigest}`,
        `attestation:${attestationId}`,
      ],
    });
  }

  if (scanId) {
    const findings = await getStoredFindings(scanId);
    if (!findings) throw new Error(`Findings not found for scanId ${scanId}.`);
    return buildCommerceBinding({
      ...requestFields,
      operation,
      repository: `${findings.repo.owner}/${findings.repo.name}`,
      branch: findings.repo.branch,
      commitSha: commitSha ?? findings.repo.commitSha ?? "unknown",
      findingIds: [],
    });
  }

  if (taskId) {
    const task = await getAgentTask(taskId);
    if (task?.scanId) {
      const findings = await getStoredFindings(task.scanId);
      if (findings) {
        return buildCommerceBinding({
          ...requestFields,
          operation,
          repository: `${findings.repo.owner}/${findings.repo.name}`,
          branch: findings.repo.branch,
          commitSha: commitSha ?? findings.repo.commitSha ?? "unknown",
          findingIds: [],
        });
      }
    }
  }

  if (repoUrl) {
    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) throw new Error("Invalid repository URL.");
    return buildCommerceBinding({
      ...requestFields,
      operation,
      repository: `${parsed.owner}/${parsed.repo}`,
      branch,
      commitSha: commitSha ?? "pending_scan",
      findingIds: [],
    });
  }

  if (operation === "repository_health_delta") {
    const baseSha = typeof body.baseCommitSha === "string" ? body.baseCommitSha : "";
    const headSha = typeof body.headCommitSha === "string" ? body.headCommitSha : "";
    const repository =
      typeof body.repository === "string"
        ? body.repository
        : repoUrl
          ? (() => {
              const p = parseGitHubUrl(repoUrl);
              return p ? `${p.owner}/${p.repo}` : "unknown/unknown";
            })()
          : "unknown/unknown";
    return buildCommerceBinding({
      ...requestFields,
      operation,
      repository,
      branch,
      commitSha: headSha || baseSha || "unknown",
      findingIds: [],
    });
  }

  throw new Error("Unable to resolve commerce binding — provide scanId, taskId, or repoUrl.");
}
