import { getServerBaseUrl } from "@/lib/docs/base-url";
import { getCanonicalOkxIdentity } from "@/lib/okx/identity";
import {
  IMMEDIATE_TASK_ACKNOWLEDGEMENT,
  IMMEDIATE_TASK_ACKNOWLEDGEMENT_SHORT,
  IMMEDIATE_TASK_ACKNOWLEDGEMENT_WITH_REPO,
  IMMEDIATE_TASK_ACKNOWLEDGEMENT_WITH_REPO_SHORT,
} from "@/lib/a2a/okx-marketplace-lifecycle";

const DISCOVERY_PATTERNS = [
  /agent\s*(id\s*)?9636/i,
  /use the services of agent/i,
  /hire\s+agent\s*9636/i,
  /repodiet.*service/i,
  /verified\s+repository\s+cleanup/i,
  /repository\s+cleanup\s+task/i,
  /create\s+a\s+repository\s+cleanup\s+task/i,
];

/** Conversational status/capability questions — not a hire-intent trigger, no scope demanded. */
const INFORMATIONAL_PATTERNS = [
  /\bis\s+repodiet\s+online\b/i,
  /\bis\s+agent\s*(id\s*)?9636\s+online\b/i,
  /what\s+does\s+repodiet(\s+quick\s*triage)?\s+do/i,
  /what\s+is\s+repodiet(\s+quick\s*triage)?/i,
  /can\s+repodiet\s+create\s+a\s+(cleanup\s+)?pull\s+request/i,
  /does\s+repodiet\s+(support|create|open|deliver)\s+(a\s+)?(cleanup\s+)?pull\s+request/i,
  /what\s+services?\s+(are|is)\s+available/i,
  /what\s+services?\s+does\s+repodiet\s+(offer|provide|have)/i,
  // The "you"-form. Every pattern above names RepoDiet explicitly, so a
  // reviewer addressing the agent directly ("What services do you offer?")
  // fell through to INVALID_TASK_TYPE and got HTTP 400 — verified live against
  // production on 2026-08-02. It is one of OKX's standard discovery prompts.
  /what\s+(services?|can)\s+(do\s+)?you\s+(offer|provide|have|do)/i,
  /what\s+do\s+you\s+do\b/i,
  /which\s+services?\s+do\s+you\s+(offer|provide|support)/i,
  /can\s+repodiet\s+(inspect|analy[sz]e|scan|review|diagnose)\s+(my\s+)?repository/i,
  /what\s+information\s+do\s+you\s+need/i,
  /what\s+(info|information)\s+is\s+(required|needed)/i,
  /how\s+much\s+(do|does)\s+(the\s+)?services?\s+cost/i,
  /what\s+(is|are)\s+the\s+(price|cost|fee)s?/i,
  /how\s+much\s+(is|does)\s+repodiet\s+cost/i,
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

/** Conversational status/capability question — answer informatively, don't demand scope. */
export function isInformationalQuery(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return INFORMATIONAL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Cleanup intent stated in prose rather than as a `type` field.
 *
 * OKX rejection class #6 was exactly this: a reviewer wrote "The task is:
 * type=create_cleanup_pr" and RepoDiet answered "could not map it to a cleanup
 * task type". The bridge (openclaw-plugins/repodiet-a2a-bridge) was taught to
 * classify intent and forward a `type` in PR #141, but that only covers XMTP
 * traffic routed through the bridge — the intake endpoint itself still could
 * not read prose, so any other caller got the same wrong answer. Verified live
 * on 2026-08-02: "The task is: type=create_cleanup_pr." and "I need a safe
 * cleanup pull request for my JavaScript repository." both returned HTTP 400.
 *
 * Note `\b` cannot be used around "cleanup" inside "create_cleanup_pr" because
 * "_" is a word character — the same trap that defeated the bridge's original
 * pattern.
 */
const CLEANUP_INTENT_PATTERNS = [
  /\bclean[\s-]?up\b/i,
  /\bpull\s*request\b/i,
  /\b(open|create)\s+(a\s+)?pr\b/i,
  /create_cleanup_pr/i,
  /repository\.(safe_cleanup|verified_cleanup|cleanup_pr)/i,
];

/**
 * Returns the canonical task type when the text states a cleanup intent.
 * Deliberately returns undefined otherwise, so a genuine discovery question is
 * never coerced into a task.
 */
export function inferCleanupTaskTypeFromText(text: string | undefined): string | undefined {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return undefined;
  return CLEANUP_INTENT_PATTERNS.some((pattern) => pattern.test(trimmed))
    ? "repository.safe_cleanup"
    : undefined;
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
    registeredDefaultPrice: "negotiated (default 1 USD₮0)",
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
    taskPolicy: {
      availabilityOnly: true,
      startWork: false,
      fundEscrow: false,
      repositoryScan: false,
      createBranch: false,
      createPullRequest: false,
      paymentAuthorised: false,
    },
    permittedActions: ["record_provider_response"],
    multiTenant: true,
    repositoryAllowlist: false,
    scanStarted: false,
  };
}

/** Answers a conversational status/capability question without demanding repository scope. */
export function buildInformationalResponse(requestId: string) {
  const baseUrl = getServerBaseUrl();
  const identity = getCanonicalOkxIdentity();

  return {
    ok: true,
    terminal: true,
    status: "AVAILABLE",
    acknowledged: true,
    immediateAcknowledgement: true,
    aspAgentId: String(identity.aspAgentId),
    a2aServiceId: String(identity.a2aServiceId),
    a2mcpServiceId: String(identity.a2mcpServiceId),
    service: "RepoDiet — Verified Repository Cleanup",
    message:
      "RepoDiet (Agent 9636) is online.\n\n" +
      "A2MCP Quick Triage (service 37347, analyze_repository) — read-only repository diagnosis via x402 pay-per-call (0.03 USD₮0). Returns prioritized findings; makes no changes.\n\n" +
      "A2A Verified Cleanup PR (service 37348, create_cleanup_pr) — tested GitHub PR delivery: negotiated scope, escrow, evidence-backed cleanup on an isolated branch, buyer acceptance, then release. Yes, RepoDiet can create a cleanup pull request through this service.\n\n" +
      "To start either one, share a repository URL and the scope you have in mind.",
    services: {
      a2mcp: {
        serviceId: String(identity.a2mcpServiceId),
        operation: "analyze_repository",
        description: "Read-only repository diagnosis via x402 pay-per-call.",
        priceLabel: "0.03 USD₮0",
        endpoint: `${baseUrl}/api/a2mcp/quick-triage`,
      },
      a2a: {
        serviceId: String(identity.a2aServiceId),
        operation: "create_cleanup_pr",
        description: "Tested GitHub pull-request delivery: negotiated scope, escrow, buyer acceptance, release.",
        priceLabel: "negotiated (default 1 USD₮0)",
      },
    },
    nextAction: "PROVIDE_REPOSITORY_SCOPE_IF_INTERESTED",
    sessionSource: "OKX_A2A",
    paymentChannel: "okx_escrow_only",
    directWebsitePaymentHidden: true,
    requestId,
    retryable: false,
    paymentRequired: false,
    paymentAlreadySettled: false,
    taskPolicy: {
      availabilityOnly: true,
      startWork: false,
      fundEscrow: false,
      repositoryScan: false,
      createBranch: false,
      createPullRequest: false,
      paymentAuthorised: false,
    },
    permittedActions: ["record_provider_response"],
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
