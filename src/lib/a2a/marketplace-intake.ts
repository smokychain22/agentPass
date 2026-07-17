import { getServerBaseUrl } from "@/lib/docs/base-url";
import { getCanonicalOkxIdentity } from "@/lib/okx/identity";

const DISCOVERY_PATTERNS = [
  /agent\s*(id\s*)?5283/i,
  /use the services of agent/i,
  /hire\s+agent\s*5283/i,
  /repodiet.*service/i,
  /verified\s+repository\s+cleanup/i,
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
    aspAgentId: String(identity.aspAgentId),
    a2aServiceId: String(identity.a2aServiceId),
    a2mcpServiceId: String(identity.a2mcpServiceId),
    service: "RepoDiet — Verified Repository Cleanup",
    message:
      "RepoDiet can analyze and clean a GitHub repository through a verified pull request. This response is immediate and does not start a deep scan. Provide repository scope below. Any authorized OKX buyer may use any GitHub repository they control — there is no repository allowlist.",
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
    repositoryIntakeEndpoint: `${baseUrl}/api/okx/intake/repository`,
    quickTriageEndpoint: `${baseUrl}/api/a2mcp/quick-triage`,
    deepScanEndpoint: `${baseUrl}/api/deep-scans`,
    a2aOrderEndpoint: `${baseUrl}/api/okx/a2a/orders`,
    taskStatusEndpoint: `${baseUrl}/api/a2a/tasks/{taskId}`,
    requestId,
    retryable: false,
    paymentRequired: false,
    paymentAlreadySettled: false,
    multiTenant: true,
    repositoryAllowlist: false,
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
      : "Task accepted. Full repository analysis runs as a durable deep-scan job; this acknowledgement does not wait for scan completion.",
    retryable: true,
    paymentRequired: false,
    paymentAlreadySettled: false,
  };
}
