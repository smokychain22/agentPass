import { getServerBaseUrl } from "@/lib/docs/base-url";
import { getCanonicalOkxIdentity } from "@/lib/okx/identity";
import {
  IMMEDIATE_TASK_ACKNOWLEDGEMENT,
  IMMEDIATE_TASK_ACKNOWLEDGEMENT_SHORT,
  IMMEDIATE_TASK_ACKNOWLEDGEMENT_WITH_REPO,
  IMMEDIATE_TASK_ACKNOWLEDGEMENT_WITH_REPO_SHORT,
} from "@/lib/a2a/okx-marketplace-lifecycle";

const DISCOVERY_PATTERNS = [
  /agent\s*(id\s*)?5283/i,
  /use the services of agent/i,
  /hire\s+agent\s*5283/i,
  /repodiet.*service/i,
  /verified\s+repository\s+cleanup/i,
  /repository\s+cleanup\s+task/i,
  /create\s+a\s+repository\s+cleanup\s+task/i,
];

export function extractUserMessage(body: Record<string, unknown>): string | undefined {
  const candidates = [
    body.message,
    body.prompt,
    body.text,
    body.userMessage,
    body.input,
    body.content,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function isMarketplaceDiscoveryMessage(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return DISCOVERY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** Extract a GitHub repository URL from free-form reviewer / marketplace text. */
export function extractRepositoryUrlFromText(text: string): string | undefined {
  const match = text.match(
    /https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?/i
  );
  if (!match) return undefined;
  return match[0].replace(/\.git$/i, "");
}

export function resolveIntakeRepositoryUrl(body: Record<string, unknown>): string | undefined {
  if (typeof body.repoUrl === "string" && body.repoUrl.trim()) {
    return body.repoUrl.trim().replace(/\.git$/i, "");
  }
  const message = extractUserMessage(body);
  if (!message) return undefined;
  return extractRepositoryUrlFromText(message);
}

export function buildMarketplaceIntakeResponse(requestId: string) {
  const baseUrl = getServerBaseUrl();
  const identity = getCanonicalOkxIdentity();

  return {
    ok: true,
    terminal: false,
    status: "AVAILABLE",
    marketplaceLifecycle: "WAITING_FOR_REPOSITORY",
    acknowledged: true,
    immediateAcknowledgement: true,
    aspAgentId: String(identity.aspAgentId),
    a2aServiceId: String(identity.a2aServiceId),
    a2mcpServiceId: String(identity.a2mcpServiceId),
    service: "RepoDiet — Verified Repository Cleanup",
    message: IMMEDIATE_TASK_ACKNOWLEDGEMENT,
    messageShort: IMMEDIATE_TASK_ACKNOWLEDGEMENT_SHORT,
    supported: {
      languages: ["JavaScript", "TypeScript"],
      frameworks: ["React", "Next.js", "Node.js"],
      packageManagers: ["npm", "pnpm", "yarn"],
      supportMatrixUrl: `${baseUrl}/api/okx/support`,
    },
    scopeQuestions: [
      "repository URL (https://github.com/owner/repository)",
      "target branch",
      "project root if this is a monorepo",
      "cleanup objective",
      "required verification commands",
    ],
    deliveryPlan: [
      "Check repository visibility and language support",
      "Request GitHub App install when private access or PR write is needed",
      "Pin source commit and enqueue durable analysis",
      "Return evidence-backed findings for exact approval",
      "Quote, escrow, worker cleanup, GitHub pull request, signed proof",
    ],
    nextAction: "PROVIDE_REPOSITORY_SCOPE",
    contractState: "SCOPE_PENDING",
    sessionSource: "OKX_A2A",
    paymentChannel: "okx_escrow_only",
    directWebsitePaymentHidden: true,
    repositoryIntakeEndpoint: `${baseUrl}/api/okx/intake/repository`,
    quickTriageEndpoint: `${baseUrl}/api/a2mcp/quick-triage`,
    deepScanEndpoint: `${baseUrl}/api/deep-scans`,
    a2aOrderEndpoint: `${baseUrl}/api/okx/a2a/orders`,
    taskStatusEndpoint: `${baseUrl}/api/a2a/tasks/{taskId}`,
    agentHealthEndpoint: `${baseUrl}/api/okx/agent-health`,
    requestId,
    retryable: false,
    paymentRequired: false,
    paymentAlreadySettled: false,
    multiTenant: true,
    repositoryAllowlist: false,
    scanStarted: false,
  };
}

export function buildAsyncTaskAcknowledgement(input: {
  taskId: string;
  contractState?: "SCOPE_PENDING" | "SCOPE_LOCKED" | "REPOSITORY_RECEIVED";
  nextAction?: string;
  estimatedDelivery?: string;
  statusUrl: string;
  workerUnavailable?: boolean;
  deepScanJobId?: string;
  queueJobId?: string;
  deepScanProgressUrl?: string;
  hasRepository?: boolean;
  requestedTaskType?: string;
  currentPhase?: string;
  status?: string;
  dispatchState?: string;
  workflowRunId?: string;
}) {
  const hasRepository = input.hasRepository === true || Boolean(input.deepScanJobId);
  const lifecycle =
    input.contractState === "SCOPE_LOCKED"
      ? "ANALYZING"
      : hasRepository
        ? "ANALYSIS_QUEUED"
        : "WAITING_FOR_REPOSITORY";

  return {
    ok: true,
    terminal: false,
    status: input.workerUnavailable
      ? "DELIVERY_DELAYED"
      : input.status ?? (hasRepository ? "analysis_queued" : "ACCEPTED"),
    acknowledged: true,
    immediateAcknowledgement: true,
    marketplaceLifecycle: lifecycle,
    taskId: input.taskId,
    requestedTaskType: input.requestedTaskType,
    currentPhase: input.currentPhase ?? (hasRepository ? "repository_analysis" : "awaiting_repository"),
    dispatchState: input.dispatchState ?? (hasRepository ? "DISPATCHING" : "NOT_DISPATCHED"),
    contractState:
      input.contractState ?? (hasRepository ? "REPOSITORY_RECEIVED" : "SCOPE_PENDING"),
    nextAction: input.nextAction ?? "POLL_TASK_STATUS",
    estimatedDelivery: input.estimatedDelivery ?? "typically 5–30 minutes depending on repository size",
    statusUrl: input.statusUrl,
    deepScanJobId: input.deepScanJobId,
    queueJobId: input.queueJobId ?? input.deepScanJobId,
    deepScanProgressUrl: input.deepScanProgressUrl,
    workflowRunId: input.workflowRunId,
    code: input.workerUnavailable ? "WORKER_UNAVAILABLE" : "TASK_ACCEPTED",
    message: input.workerUnavailable
      ? "Task accepted; worker capacity is delayed. Negotiation state preserved — no funds accepted until delivery can run. Deep scan job is persisted when repository scope is known."
      : hasRepository
        ? IMMEDIATE_TASK_ACKNOWLEDGEMENT_WITH_REPO_SHORT
        : IMMEDIATE_TASK_ACKNOWLEDGEMENT_SHORT,
    messageFull: hasRepository
      ? IMMEDIATE_TASK_ACKNOWLEDGEMENT_WITH_REPO
      : IMMEDIATE_TASK_ACKNOWLEDGEMENT,
    scanStarted: hasRepository,
    sessionSource: "OKX_A2A",
    paymentChannel: "okx_escrow_only",
    directWebsitePaymentHidden: true,
    retryable: true,
    paymentRequired: false,
    paymentAlreadySettled: false,
  };
}
