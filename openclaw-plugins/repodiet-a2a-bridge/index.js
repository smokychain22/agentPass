/**
 * RepoDiet A2A Bridge — an OpenClaw plugin that makes RepoDiet's own real
 * production pipeline, never a model, the thing that answers okx-a2a
 * seller-session traffic for Agent 9636.
 *
 * Why this exists: okx-a2a's own OpenClaw plugin (@okxweb3/a2a-openclaw)
 * turns every inbound XMTP message into a normal OpenClaw agent turn (its
 * `before_agent_run` hook just queues the message into the agent-run
 * pipeline — verified directly in the installed 0.1.11 plugin bundle, see
 * scripts/seller-runtime-supervisor.ts's module docblock). Left alone, that
 * agent turn would be answered by whatever model OpenClaw has configured —
 * which is exactly the prohibited "Claude/Codex/Cursor acting as RepoDiet"
 * topology this runtime must never produce, and would also simply fail if
 * no model-provider credential is configured at all (none is, and none
 * should be — see .env.seller.example).
 *
 * `before_agent_reply` is OpenClaw's documented, typed hook for exactly
 * this: "Short-circuit the model turn with a synthetic reply or silence"
 * (docs/plugins/hooks.md, docs/concepts/agent-loop.md; contract verified
 * directly against the installed openclaw@2026.7.1-2 SDK type declarations,
 * dist/hook-types-*.d.ts: `PluginHookBeforeAgentReplyEvent = { cleanedBody:
 * string }`, `PluginHookBeforeAgentReplyResult = { handled: boolean; reply?:
 * ReplyPayload; reason?: string }`, `ReplyPayload = { text?: string; ... }`).
 *
 * Scope: every message inside an okx-a2a seller session for Agent 9636
 * (`sessionKey` matching `my:9636:to:<peer>`) is unconditionally claimed
 * (`handled: true`) and dispatched to the real production pipeline
 * (dispatch.js) — real A2MCP `analyze_repository` (service 37347, paid
 * x402) or real A2A task intake (service 37348 `create_cleanup_pr`, via
 * the same `/api/a2a/tasks` endpoint OKX's own reviewer already uses).
 * Every reply is either the real backend's real response or a real,
 * field-derived protocol error (logic.js) — never a fixed template.
 * Nothing in this scope ever falls through to a real model call.
 *
 * All decision + dispatch logic lives in logic.js/dispatch.js/
 * idempotency.js, none of which depend on the "openclaw" package, and all
 * of which are unit- and integration-tested directly
 * (test/repodiet-a2a-bridge.test.ts). This file is the thin adapter that
 * only the real OpenClaw runtime ever loads.
 *
 * Activated by scripts/seller-runtime-supervisor.ts via
 * `plugins.load.paths` + `plugins.entries.repodiet-a2a-bridge.hooks.
 * allowConversationAccess` + `plugins.allow` — see that file's module
 * docblock for the exact config calls and the startup verification step
 * (`openclaw plugins inspect repodiet-a2a-bridge --runtime --json`).
 */

// definePluginEntry is the documented plugin-entry contract (docs/plugins/
// building-plugins.md quickstart) — used as-is rather than a raw exported
// object so this plugin gets the same validation/typing every other
// OpenClaw plugin entry gets. Only this file (never logic.js/dispatch.js/
// idempotency.js) depends on the "openclaw" package, which is resolvable
// only inside a real OpenClaw runtime/container, not this repo's own
// node_modules.
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { decideReply } from "./logic.js";

export default definePluginEntry({
  id: "repodiet-a2a-bridge",
  name: "RepoDiet A2A Bridge",
  description:
    "Dispatches okx-a2a seller-session (Agent 9636) messages to RepoDiet's real production pipeline, never an LLM turn.",
  register(api) {
    api.on("before_agent_reply", async (event, ctx) => decideReply(event, ctx));
  },
});
