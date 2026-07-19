import { getServerBaseUrl } from "@/lib/docs/base-url";
import { getCanonicalOkxIdentity } from "@/lib/okx/identity";
import {
  IMMEDIATE_TASK_ACKNOWLEDGEMENT,
  IMMEDIATE_TASK_ACKNOWLEDGEMENT_SHORT,
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

export function buildMarketplaceIntakeResponse(requestId: string) {
  const baseUrl = getServerBaseUrl();
  const identity = getCanonicalOkxIdentity();

  return {
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
  contractState?: "SCOPE_PENDING" | "SCOPE_LOCKED";
  nextAction?: string;
  estimatedDelivery?: string;
  statusUrl: string;
  workerUnavailable?: boolean;
  deepScanJobId?: string;
  deepScanProgressUrl?: string;
}) {
  return {
    status: input.workerUnavailable ? "DELIVERY_DELAYED" : "ACCEPTED",
    acknowledged: true,
    immediateAcknowledgement: true,
    marketplaceLifecycle: input.contractState === "SCOPE_LOCKED" ? "ANALYZING" : "WAITING_FOR_REPOSITORY",
    taskId: input.taskId,
    contractState: input.contractState ?? "SCOPE_PENDING",
    nextAction: input.nextAction ?? "POLL_TASK_STATUS",
    estimatedDelivery: input.estimatedDelivery ?? "typically 5–30 minutes depending on repository size",
    statusUrl: input.statusUrl,
    deepScanJobId: input.deepScanJobId,
    deepScanProgressUrl: input.deepScanProgressUrl,
    code: input.workerUnavailable ? "WORKER_UNAVAILABLE" : "TASK_ACCEPTED",
    message: input.workerUnavailable
      ? "Task accepted; worker capacity is delayed. Negotiation state preserved — no funds accepted until delivery can run. Deep scan job is persisted when repository scope is known."
      : IMMEDIATE_TASK_ACKNOWLEDGEMENT_SHORT,
    messageFull: IMMEDIATE_TASK_ACKNOWLEDGEMENT,
    scanStarted: false,
    sessionSource: "OKX_A2A",
    paymentChannel: "okx_escrow_only",
    directWebsitePaymentHidden: true,
    retryable: true,
    paymentRequired: false,
    paymentAlreadySettled: false,
  };
}
