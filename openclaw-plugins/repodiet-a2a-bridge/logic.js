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
import {
  deriveInboundIdentity,
  getPublication,
  getRecordedDispatch,
  recordDispatch,
  recordPublication,
} from "./idempotency.js";
import { publishReply } from "./publish.js";
import {
  describeSessionKeyShape,
  parseSessionKey,
  toTransportSessionKey,
} from "./session-key.js";

/**
 * Structured, single-line observability for the seller response path. Emits
 * only non-secret routing metadata — never wallet keys, gateway tokens, API
 * keys, session secrets, payment signatures, or repository contents. The
 * reply text itself is deliberately NOT logged: it can quote private
 * repository data back to the operator log.
 *
 * Before this existed, a reviewer message that produced no answer left no
 * trace at all, which is why the outage stayed invisible through an entire
 * rejection cycle.
 */
export function emitSellerResponseEvent(fields, log = console.warn) {
  log(`repodiet-a2a-bridge ${JSON.stringify(fields)}`);
}

/**
 * Real seller sessionKeys are job-scoped and are NOT bare `my:...` strings.
 * Verified against production gateway logs on Machine 7845320c476008:
 *
 *   dispatchSessionMessage sessionKey=job:0xe7ca8d67…:my:9636:to:8178
 *   sessionKey=job:0x438e701c…:my:9636:to:1791
 *   sessionKey=backup:0x74e4c2b1…            <- buyer-side, myAgentId 5295
 *
 * The previous pattern was anchored `^my:` and therefore could never match a
 * real inbound seller message. decideReply() returned undefined, OpenClaw fell
 * through to the built-in default model, and that model does not exist in this
 * deployment ("Unknown model: openai/gpt-5.5") — so the run ended `state=error`
 * and no reply was ever transmitted. That is the exact "sent a task but
 * received no response before timeout" the OKX review reported: reviewer agent
 * 8178 ("sandbox") sent five messages on 2026-08-01 and received silence.
 *
 * The `(?:^|:)` prefix accepts both the job-scoped form and a bare
 * `my:9636:to:<peer>` form, while the required `:my:9636:to:` segment keeps
 * `backup:…`, `system-notification`, and other agents' sessions unclaimed.
 */
export const SELLER_SESSION_PATTERN = /(?:^|:)my:9636:to:([^:]+)$/;

/**
 * The okx-a2a plugin carries TWO distinct identifiers for the same exchange,
 * and logs both on every inbound message:
 *
 *   sessionKey=job:0xe7ca8d67…:my:9636:to:8178
 *   gatewaySessionKey=agent:main:okx-a2a:group:okx-xmtp:my=9636&to=8178&job=0xe7ca8d67…
 *
 * `before_agent_reply` is an OpenClaw hook, so `ctx.sessionKey` may carry the
 * gateway-encoded form (`my=9636&to=…`) rather than the A2A colon form. Which
 * one arrives is a detail of the plugin/gateway boundary that we must not
 * guess at — guessing that it was the colon form is precisely what produced
 * the outage this module is fixing. Accepting both encodings is correct under
 * either contract and cannot silently regress if the boundary changes.
 */
export const SELLER_GATEWAY_SESSION_PATTERN = /[:&?]my=9636&to=([^&]+)/;

const GITHUB_URL_PATTERN = /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/i;

// Routing only — decides WHICH real endpoint to call, never what to say.
// A message matching neither list is not rejected; it is forwarded as-is
// to the real intake endpoint, which already classifies discovery /
// informational / scope-required messages dynamically on the server.
const ANALYSIS_ONLY_PATTERNS = [/\banaly[sz]e[sd]?\b/i, /\bdiagnos(e|is|tic)/i, /\bquick\s*triage\b/i, /\binspect\b/i];
const CLEANUP_PATTERNS = [/\bclean[\s-]?up\b/i, /\bpull\s*request\b/i, /\b(open|create)\s+(a\s+)?pr\b/i, /\bfix\s+(it|this|the)\b/i, /\bcreate\s+a\s+(repository\s+)?cleanup\s+task\b/i];

export function isSellerSession(sessionKey) {
  if (typeof sessionKey !== "string") return false;
  return (
    SELLER_SESSION_PATTERN.test(sessionKey) || SELLER_GATEWAY_SESSION_PATTERN.test(sessionKey)
  );
}

/**
 * Diagnostic for the failure mode that made this outage invisible: an
 * unclaimed session produces no bridge log at all, falls through to the model,
 * and dies as an opaque `state=error` with no indication that the bridge
 * declined it. Logging the declined key means any future key-format change
 * shows up directly in the runtime log instead of as silence.
 */
export function describeUnclaimedSession(sessionKey) {
  return `repodiet-a2a-bridge: declined sessionKey=${
    typeof sessionKey === "string" ? sessionKey : typeof sessionKey
  } (not an Agent 9636 seller exchange) — falling through to the model`;
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
async function generateReply(event, ctx, deps = {}) {
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

/**
 * Real decision + dispatch + PUBLICATION entry point.
 *
 * Returning `{ handled: true, reply }` is necessary but NOT sufficient:
 * OpenClaw honours it and records the reply in the session transcript, but
 * nothing in the okx-a2a plugin publishes a hook-handled reply back onto XMTP
 * (see publish.js for the full trace). So the reply is also published here,
 * explicitly, through the daemon's documented `xmtp-send` interface.
 *
 * Publication is keyed on the inbound transport message identity, so:
 *   - each distinct reviewer follow-up under one job gets exactly one reply,
 *   - an exact redelivery of the same envelope never produces a second reply,
 *   - a transport failure leaves nothing recorded and stays retryable.
 */
export async function decideReply(event, ctx, deps = {}) {
  const started = Date.now();
  const log = deps.log ?? console.warn;

  if (!isSellerSession(ctx?.sessionKey)) {
    log(describeUnclaimedSession(ctx?.sessionKey));
    return undefined;
  }

  const emit = deps.emit ?? emitSellerResponseEvent;
  const publish = deps.publishReply ?? publishReply;
  const readPublication = deps.getPublication ?? getPublication;
  const writePublication = deps.recordPublication ?? recordPublication;

  const parsed = parseSessionKey(ctx?.sessionKey);
  const transportSessionKey = toTransportSessionKey(parsed);
  const inbound = deriveInboundIdentity(event?.cleanedBody, ctx);

  const alreadyPublished = readPublication(inbound.key);
  if (alreadyPublished) {
    // The reply for THIS inbound transport message is already on the wire.
    // Still claim the turn so it cannot fall through to the model, but never
    // publish a second copy.
    const replayed = await generateReply(event, ctx, deps);
    emit(
      {
        event: "seller_response",
        outcome: "already_published",
        inboundIdentitySource: inbound.source,
        sessionKeyShape: describeSessionKeyShape(ctx?.sessionKey),
        claimed: true,
        peerAgentId: parsed?.peerAgentId,
        localAgentId: parsed?.myAgentId,
        outboundMessageId: alreadyPublished.messageId,
        publicationStatus: "suppressed_duplicate",
        elapsedMs: Date.now() - started,
      },
      log
    );
    return replayed;
  }

  const result = await generateReply(event, ctx, deps);
  const replyText = result?.reply?.text;

  const publication = await publish({ transportSessionKey, text: replyText }, deps);
  if (publication.ok) writePublication(inbound.key, publication);

  emit(
    {
      event: "seller_response",
      outcome: publication.ok ? "published" : "publish_failed",
      inboundIdentitySource: inbound.source,
      sessionKeyShape: describeSessionKeyShape(ctx?.sessionKey),
      claimed: true,
      localAgentId: parsed?.myAgentId,
      peerAgentId: parsed?.peerAgentId,
      classification: result?.reason,
      responseGenerated: Boolean(replyText),
      outboundSendAttempted: true,
      outboundMessageId: publication.messageId,
      publicationStatus: publication.ok ? "published" : "failed",
      failureCode: publication.failureCode,
      elapsedMs: Date.now() - started,
    },
    log
  );

  return result;
}
