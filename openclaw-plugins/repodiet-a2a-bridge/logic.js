/**
 * Real decision logic for the RepoDiet A2A Bridge OpenClaw plugin. No
 * dependency on the "openclaw" package, so this module can be imported and
 * unit-tested directly (see test/repodiet-a2a-bridge.test.ts) without a
 * live OpenClaw runtime. index.js wires this into the actual
 * `before_agent_reply` hook.
 *
 * Every reply this module produces is derived from one of:
 *   (a) the real, live response of RepoDiet's already-proven production
 *       API (dispatch.js) for the exact request received, or
 *   (b) a protocol-validation error whose content (which field, what
 *       service) is computed from the actual request, not fixed prose.
 *
 * There is no fixed "we're online" / "request received" template anywhere
 * in this file. Two earlier constants (SAFE_REPLY, ESCALATION_REPLY) were
 * removed for exactly that reason — they answered without dispatching
 * anything real, which is the "canned production responder" this plugin
 * must not be.
 */
import { dispatchAnalyzeRepository, dispatchCreateTask } from "./dispatch.js";
import { getRecordedDispatch, recordDispatch } from "./idempotency.js";

export const SELLER_SESSION_PATTERN = /^my:9636:to:(.+)$/;

const GITHUB_URL_PATTERN = /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/i;

// Routing only — decides WHICH real endpoint to call, never what to say.
// A message matching neither list is not rejected; it is forwarded as-is
// to the real intake endpoint, which already classifies discovery /
// informational / scope-required messages dynamically on the server.
const ANALYSIS_ONLY_PATTERNS = [/\banaly[sz]e[sd]?\b/i, /\bdiagnos(e|is|tic)/i, /\bquick\s*triage\b/i, /\binspect\b/i];
const CLEANUP_PATTERNS = [/\bclean[\s-]?up\b/i, /\bpull\s*request\b/i, /\b(open|create)\s+(a\s+)?pr\b/i, /\bfix\s+(it|this|the)\b/i, /\bcreate\s+a\s+(repository\s+)?cleanup\s+task\b/i];

export function isSellerSession(sessionKey) {
  return typeof sessionKey === "string" && SELLER_SESSION_PATTERN.test(sessionKey);
}

export function extractRepositoryUrl(text) {
  const match = (text ?? "").match(GITHUB_URL_PATTERN);
  if (!match) return undefined;
  return match[0].replace(/\.git$/i, "").replace(/[),.;!?]+$/, "");
}

export function classifyServiceIntent(text) {
  const wantsCleanup = CLEANUP_PATTERNS.some((pattern) => pattern.test(text ?? ""));
  if (wantsCleanup) return "create_cleanup_pr";
  const wantsAnalysis = ANALYSIS_ONLY_PATTERNS.some((pattern) => pattern.test(text ?? ""));
  if (wantsAnalysis) return "analyze_repository";
  return "unspecified";
}

/**
 * Dynamic protocol-validation error. Content is computed from the actual
 * missing field(s) and the actual service being requested — never a fixed
 * string. Structured (JSON-shaped fields named in prose) so a counterparty
 * agent can parse what is missing without guessing.
 */
export function buildProtocolError(service, missingFields) {
  return `PROTOCOL_VALIDATION_ERROR service=${service} missingFields=[${missingFields.join(",")}]: ${missingFields.join(" and ")} required and not present in this message.`;
}

/**
 * Formats a real A2MCP dispatch result. Every value here (amount, asset,
 * payTo, quoteId, finding counts) is read directly off the real HTTP
 * response body — nothing is invented if the field is absent.
 */
export function formatAnalysisDispatchResult(result) {
  const body = result?.body ?? {};
  if (result?.status === 402) {
    const accept = Array.isArray(body.accepts) ? body.accepts[0] : undefined;
    const parts = [
      `amount=${accept?.amount ?? "unknown"}`,
      `asset=${accept?.extra?.name ?? accept?.asset ?? "unknown"}`,
      `network=${accept?.network ?? "unknown"}`,
      `payTo=${accept?.payTo ?? "unknown"}`,
      `quoteId=${body.quoteId ?? "unknown"}`,
    ];
    return `PAYMENT_REQUIRED service=analyze_repository(37347) ${parts.join(" ")}. Complete payment via the standard x402 flow, then resubmit.`;
  }
  if (result?.status === 200) {
    const findings = Array.isArray(body.findings) ? body.findings.length : undefined;
    if (findings !== undefined) {
      return `RESULT service=analyze_repository(37347) findingsReturned=${findings} scanId=${body.scanId ?? "unknown"}.`;
    }
  }
  const detail = body.error ?? body.message ?? JSON.stringify(body).slice(0, 300);
  return `DISPATCH_ERROR service=analyze_repository(37347) httpStatus=${result?.status ?? "unknown"} detail=${detail}`;
}

/**
 * Formats a real A2A task-intake dispatch result. When the backend
 * returns its own `message` field (discovery text, informational answer,
 * SCOPE_REQUIRED guidance, or a task acknowledgement — all generated
 * server-side by the same code path OKX's own reviewer already exercises,
 * src/app/api/a2a/tasks/route.ts), that real text is relayed verbatim. It
 * is never replaced by a locally-fixed string.
 */
export function formatTaskDispatchResult(result) {
  const body = result?.body ?? {};
  const taskId = body.task?.id ?? body.id;
  const suffix = taskId ? ` taskId=${taskId} status=${body.task?.status ?? body.status ?? "unknown"}` : "";
  if (typeof body.message === "string" && body.message.trim()) {
    return `${body.message}${suffix}`;
  }
  if (body.error) {
    return `DISPATCH_ERROR service=create_cleanup_pr(37348) code=${body.code ?? result?.status ?? "unknown"} detail=${body.error}`;
  }
  return `DISPATCH_ERROR service=create_cleanup_pr(37348) httpStatus=${result?.status ?? "unknown"} detail=${JSON.stringify(body).slice(0, 300)}`;
}

/**
 * Real decision + dispatch entry point. `deps` allows tests to inject a
 * fake fetch/idempotency store without touching production or the
 * filesystem; production (index.js) calls this with no overrides, so the
 * real dispatch.js / idempotency.js modules are used.
 *
 * Always returns `handled: true` once a session is identified as an Agent
 * 9636 seller session — nothing in that scope ever falls through to a
 * model call — but what it returns is always either a real dispatch
 * result or a real, field-derived protocol error, never a fixed template.
 */
export async function decideReply(event, ctx, deps = {}) {
  if (!isSellerSession(ctx?.sessionKey)) {
    return undefined; // Not an Agent 9636 seller exchange — not this plugin's concern.
  }

  const fetchImpl = deps.fetch;
  const analyzeRepository = deps.dispatchAnalyzeRepository ?? dispatchAnalyzeRepository;
  const createTask = deps.dispatchCreateTask ?? dispatchCreateTask;
  const getRecorded = deps.getRecordedDispatch ?? getRecordedDispatch;
  const record = deps.recordDispatch ?? recordDispatch;

  const text = (event?.cleanedBody ?? "").trim();
  const identityKey = ctx?.jobId || ctx?.sessionKey;

  if (!text) {
    return {
      handled: true,
      reply: { text: buildProtocolError("unknown", ["message"]) },
      reason: "repodiet_protocol_error",
    };
  }

  if (identityKey) {
    const existing = getRecorded(identityKey, text);
    if (existing) {
      return { handled: true, reply: { text: existing.replyText }, reason: "repodiet_idempotent_replay" };
    }
  }

  const intent = classifyServiceIntent(text);
  const repositoryUrl = extractRepositoryUrl(text);

  let replyText;
  let reason;

  if (intent === "analyze_repository") {
    if (!repositoryUrl) {
      replyText = buildProtocolError("analyze_repository", ["repositoryUrl"]);
      reason = "repodiet_protocol_error";
    } else {
      const result = await analyzeRepository({ repositoryUrl }, fetchImpl);
      replyText = formatAnalysisDispatchResult(result);
      reason = `repodiet_a2mcp_dispatch_status_${result.status}`;
    }
  } else {
    // "create_cleanup_pr" intent and "unspecified" intent both forward to
    // the real intake endpoint — for "unspecified" this deliberately lets
    // the real backend's own discovery/informational classification
    // decide, rather than this plugin guessing or templating a reply.
    const result = await createTask({ message: text, repoUrl: repositoryUrl }, fetchImpl);
    replyText = formatTaskDispatchResult(result);
    reason = `repodiet_a2a_dispatch_status_${result.status}`;
  }

  if (identityKey) {
    record(identityKey, text, { replyText });
  }

  return { handled: true, reply: { text: replyText }, reason };
}
