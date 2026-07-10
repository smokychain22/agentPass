import { submitA2ATask, formatA2ATaskResponse } from "@/lib/a2a/orchestrator";
import { selectSafeFixes } from "@/lib/execution";
import { parseGitHubUrl } from "@/lib/github/parse-github-url";
import type { A2aServiceId } from "./types";
import { getA2aService } from "./services";
import { newOkxOrderId, saveOkxOrder } from "./store";
import { durableNow } from "@/lib/store/durable-store";

export interface CreateA2aOrderInput {
  serviceId: A2aServiceId;
  repoUrl: string;
  branch?: string;
  commitSha?: string;
  findingIds?: string[];
  quoteId?: string;
  escrowReference?: string;
  callbackUrl?: string;
}

const SERVICE_TO_TASK_TYPE: Record<
  A2aServiceId,
  | "repository.verified_cleanup"
  | "repository.cleanup_pr"
  | "repository.guard_activation"
> = {
  verified_cleanup_pr: "repository.verified_cleanup",
  deep_cleanup_review: "repository.cleanup_pr",
  repo_guard_mission: "repository.guard_activation",
};

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
    findingIds: input.findingIds,
    quoteId: input.quoteId,
    callbackUrl: input.callbackUrl,
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
  };
}

/** A2A internal execution must call the engine directly — never self-charge A2MCP tools. */
export const A2A_INTERNAL_EXECUTION = true;
