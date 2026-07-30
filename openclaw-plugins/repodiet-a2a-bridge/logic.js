/**
 * Pure decision logic for the RepoDiet A2A Bridge OpenClaw plugin. No
 * dependency on the "openclaw" package itself, so this module can be
 * imported and unit-tested directly (see test/repodiet-a2a-bridge.test.ts)
 * without a live OpenClaw runtime. index.js wires this into the actual
 * `before_agent_reply` hook — see index.js's docblock for the full design
 * rationale and the verified hook contract this implements against.
 */

// Mirrors src/lib/a2a/marketplace-intake.ts's DISCOVERY_PATTERNS /
// INFORMATIONAL_PATTERNS exactly (same source of truth as the HTTP A2A
// intake route). Kept as a small, dependency-free copy because this plugin
// is loaded by OpenClaw's own module system, outside this repo's Next.js
// module graph — update both places together.
const DISCOVERY_PATTERNS = [
  /agent\s*(id\s*)?9636/i,
  /use the services of agent/i,
  /hire\s+agent\s*9636/i,
  /repodiet.*service/i,
  /verified\s+repository\s+cleanup/i,
  /repository\s+cleanup\s+task/i,
  /create\s+a\s+repository\s+cleanup\s+task/i,
];

const INFORMATIONAL_PATTERNS = [
  /\bis\s+repodiet\s+online\b/i,
  /\bis\s+agent\s*(id\s*)?9636\s+online\b/i,
  /what\s+does\s+repodiet(\s+quick\s*triage)?\s+do/i,
  /what\s+is\s+repodiet(\s+quick\s*triage)?/i,
  /can\s+repodiet\s+create\s+a\s+(cleanup\s+)?pull\s+request/i,
  /does\s+repodiet\s+(support|create|open|deliver)\s+(a\s+)?(cleanup\s+)?pull\s+request/i,
  /what\s+services?\s+(are|is)\s+available/i,
  /what\s+services?\s+does\s+repodiet\s+(offer|provide|have)/i,
  /can\s+repodiet\s+(inspect|analy[sz]e|scan|review|diagnose)\s+(my\s+)?repository/i,
  /what\s+information\s+do\s+you\s+need/i,
  /what\s+(info|information)\s+is\s+(required|needed)/i,
  /how\s+much\s+(do|does)\s+(the\s+)?services?\s+cost/i,
  /what\s+(is|are)\s+the\s+(price|cost|fee)s?/i,
  /how\s+much\s+(is|does)\s+repodiet\s+cost/i,
];

export const SELLER_SESSION_PATTERN = /^my:9636:to:(.+)$/;

export const SAFE_REPLY =
  "RepoDiet Agent 9636 is online.\n\n" +
  "Quick Triage, service 37347, provides read-only repository analysis for 0.03 USD₮0.\n\n" +
  "Verified Cleanup, service 37348, creates a tested GitHub pull request through the A2A task and escrow workflow. Its registered default fee is 1 USD₮0.\n\n" +
  "Please provide the GitHub repository URL and requested scope. No work or payment has started.";

export const ESCALATION_REPLY =
  "RepoDiet Agent 9636 received this message and is routing it for review. " +
  "No work, payment, or escrow action has started automatically.";

export function isSellerSession(sessionKey) {
  return typeof sessionKey === "string" && SELLER_SESSION_PATTERN.test(sessionKey);
}

export function isMarketplaceDiscoveryMessage(text) {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return false;
  return DISCOVERY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function isInformationalQuery(text) {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return false;
  return INFORMATIONAL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Always returns `handled: true` once a session is identified as an Agent
 * 9636 seller session: RepoDiet either answers deterministically from a
 * known-safe pattern, or deterministically escalates. Either branch is a
 * fixed template, never model-generated text, so this session scope can
 * never be answered by whatever model OpenClaw has configured.
 */
export function decideReply(event, ctx) {
  if (!isSellerSession(ctx?.sessionKey)) {
    return undefined; // Not an Agent 9636 seller exchange — not this plugin's concern.
  }
  const text = event?.cleanedBody ?? "";
  const safe = isMarketplaceDiscoveryMessage(text) || isInformationalQuery(text);
  return {
    handled: true,
    reply: { text: safe ? SAFE_REPLY : ESCALATION_REPLY },
    reason: safe ? "repodiet_safe_pattern_match" : "repodiet_seller_session_escalation",
  };
}
