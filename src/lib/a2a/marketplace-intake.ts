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
      "RepoDiet is available for verified repository cleanup. To prepare a scoped quote, provide the repository details below. Long-running cleanup runs asynchronously after scope is locked — this response is immediate and does not start a deep scan.",
    scopeQuestions: [
      "GitHub repository URL (https://github.com/owner/repository)",
      "Target branch (default: main)",
      "Project root if monorepo",
      "Cleanup objective (safe candidates, duplicates, unused deps, etc.)",
      "Required checks (typecheck, lint, test, build)",
      "Deadline or urgency",
    ],
    deliveryPlan: [
      "Inspect repository access and pin the source commit",
      "Propose evidence-backed findings and lock approved scope",
      "Execute on an isolated branch with verification",
      "Deliver a GitHub pull request and signed proof",
    ],
    nextAction: "PROVIDE_REPOSITORY_SCOPE",
    contractState: "SCOPE_PENDING",
    quickTriageEndpoint: `${baseUrl}/api/a2mcp/quick-triage`,
    a2aOrderEndpoint: `${baseUrl}/api/okx/a2a/orders`,
    taskStatusEndpoint: `${baseUrl}/api/a2a/tasks/{taskId}`,
    requestId,
    retryable: false,
    paymentRequired: false,
    paymentAlreadySettled: false,
  };
}

export function buildAsyncTaskAcknowledgement(input: {
  taskId: string;
  contractState?: "SCOPE_PENDING" | "SCOPE_LOCKED";
  nextAction?: string;
  estimatedDelivery?: string;
  statusUrl: string;
  workerUnavailable?: boolean;
}) {
  return {
    status: input.workerUnavailable ? "DELIVERY_DELAYED" : "ACCEPTED",
    taskId: input.taskId,
    contractState: input.contractState ?? "SCOPE_PENDING",
    nextAction: input.nextAction ?? "POLL_TASK_STATUS",
    estimatedDelivery: input.estimatedDelivery ?? "typically 5–30 minutes depending on repository size",
    statusUrl: input.statusUrl,
    code: input.workerUnavailable ? "WORKER_UNAVAILABLE" : "TASK_ACCEPTED",
    message: input.workerUnavailable
      ? "Task accepted; worker capacity is delayed. Negotiation state preserved — no funds accepted until delivery can run."
      : "Task accepted. Long-running cleanup is executing asynchronously.",
    retryable: true,
    paymentRequired: false,
    paymentAlreadySettled: false,
  };
}
