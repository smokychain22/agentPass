import { submitA2ATask, formatA2ATaskResponse } from "@/lib/a2a/orchestrator";
import { selectSafeFixes } from "@/lib/execution";
import { parseGitHubUrl } from "@/lib/github/parse-github-url";
import type { A2aServiceId } from "./types";
import { getA2aService } from "./services";
import { newOkxOrderId, saveOkxOrder } from "./store";
import { durableNow } from "@/lib/store/durable-store";
import { getMaintenanceContract, type MaintenanceContractRecord } from "@/lib/green-pr";

export interface CreateA2aOrderInput {
  serviceId: A2aServiceId;
  repoUrl: string;
  branch?: string;
  commitSha?: string;
  findingIds?: string[];
  quoteId?: string;
  escrowReference?: string;
  callbackUrl?: string;
  contractId?: string;
  contractDigest?: string;
}

const SERVICE_TO_TASK_TYPE: Record<
  A2aServiceId,
  | "repository.verified_cleanup"
  | "repository.cleanup_pr"
  | "repository.guard_activation"
> = {
  verified_cleanup_pr: "repository.cleanup_pr",
  deep_cleanup_review: "repository.cleanup_pr",
  repo_guard_mission: "repository.guard_activation",
};

async function requireAcceptedGreenPrContract(
  input: CreateA2aOrderInput
): Promise<MaintenanceContractRecord | undefined> {
  if (input.serviceId !== "verified_cleanup_pr" && input.serviceId !== "deep_cleanup_review") {
    return undefined;
  }
  if (!input.contractId || !input.contractDigest) {
    throw new Error(
      "maintenance_contract_required: propose and accept repodiet.contract/v1 before creating this A2A order."
    );
  }
  const record = await getMaintenanceContract(input.contractId);
  if (!record) throw new Error("maintenance_contract_not_found");
  if (record.contractDigest !== input.contractDigest) throw new Error("contract_digest_mismatch");
  if (record.status !== "accepted") throw new Error(`maintenance_contract_not_accepted:${record.status}`);
  const parsed = parseGitHubUrl(input.repoUrl);
  const repository = parsed ? `${parsed.owner}/${parsed.repo}` : "";
  const contractedRepository = `${record.contract.repository.owner}/${record.contract.repository.name}`;
  if (repository !== contractedRepository) throw new Error("contract_repository_mismatch");
  if ((input.branch ?? record.contract.repository.branch) !== record.contract.repository.branch) {
    throw new Error("contract_branch_mismatch");
  }
  if (input.commitSha && input.commitSha !== record.contract.repository.sourceCommit) {
    throw new Error("contract_source_commit_mismatch");
  }
  if (input.quoteId && input.quoteId !== record.contract.commercialTerms.quoteId) {
    throw new Error("contract_quote_mismatch");
  }
  const contractedFindings = new Set(record.contract.scope.findingIds);
  if (input.findingIds?.some((findingId) => !contractedFindings.has(findingId))) {
    throw new Error("contract_finding_scope_mismatch");
  }
  return record;
}

export async function runPreflight(input: CreateA2aOrderInput): Promise<{
  ok: boolean;
  reason?: string;
  alternative?: string;
  safeFixCount?: number;
}> {
  const parsed = parseGitHubUrl(input.repoUrl);
  if (!parsed) {
    return { ok: false, reason: "Invalid repository URL." };
  }

  try {
    const { scanRepository } = await import("@/lib/execution");
    const payload = await scanRepository(input.repoUrl, input.branch);
    const safe = selectSafeFixes(payload, 10);
    if (input.serviceId === "verified_cleanup_pr" && safe.length === 0) {
      return {
        ok: false,
        reason: "No supported automatic fix candidates found.",
        alternative: "repository_health_review",
        safeFixCount: 0,
      };
    }
    return { ok: true, safeFixCount: safe.length };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Repository unreachable.",
    };
  }
}

export async function createA2aOrder(input: CreateA2aOrderInput) {
  const service = getA2aService(input.serviceId);
  if (!service) {
    throw new Error(`Unknown A2A service: ${input.serviceId}`);
  }

  const contractRecord = await requireAcceptedGreenPrContract(input);

  const preflight = await runPreflight(input);
  if (!preflight.ok && input.serviceId === "verified_cleanup_pr") {
    return {
      ok: false,
      status: "no_actionable_fix",
      reason: preflight.reason,
      alternative: preflight.alternative ?? "repository_health_review",
    };
  }

  const orderId = newOkxOrderId();
  const taskType = SERVICE_TO_TASK_TYPE[input.serviceId];

  const task = await submitA2ATask(taskType, {
    repoUrl: input.repoUrl,
    branch: input.branch,
    findingIds: input.findingIds ?? contractRecord?.contract.scope.findingIds,
    quoteId: input.quoteId ?? contractRecord?.contract.commercialTerms.quoteId,
    callbackUrl: input.callbackUrl,
    commitSha: input.commitSha ?? contractRecord?.contract.repository.sourceCommit,
    contractId: contractRecord?.contractId,
    contractDigest: contractRecord?.contractDigest,
  });

  const parsed = parseGitHubUrl(input.repoUrl);
  const repository = parsed ? `${parsed.owner}/${parsed.repo}` : input.repoUrl;

  const order = {
    orderId,
    serviceId: input.serviceId,
    serviceType: "A2A" as const,
    repository,
    branch: input.branch ?? "main",
    commitSha: input.commitSha ?? "unknown",
    status: task.status,
    escrowReference: input.escrowReference,
    taskId: task.id,
    a2aTaskId: task.id,
    contractId: contractRecord?.contractId,
    contractDigest: contractRecord?.contractDigest,
    createdAt: durableNow(),
    updatedAt: durableNow(),
  };
  await saveOkxOrder(order);

  return {
    ok: true,
    orderId,
    taskId: task.id,
    status: task.status,
    task: formatA2ATaskResponse(task),
    preflight,
    service: {
      serviceId: service.serviceId,
      label: service.label,
      priceLabel: service.priceLabel,
      requiresEscrow: service.requiresEscrow,
    },
    maintenanceContract: contractRecord
      ? {
          contractId: contractRecord.contractId,
          contractDigest: contractRecord.contractDigest,
          status: contractRecord.status,
        }
      : undefined,
  };
}

/** A2A internal execution must call the engine directly — never self-charge A2MCP tools. */
export const A2A_INTERNAL_EXECUTION = true;
