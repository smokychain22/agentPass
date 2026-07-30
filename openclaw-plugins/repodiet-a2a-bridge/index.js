/**
 * RepoDiet A2A Bridge — an OpenClaw plugin that makes RepoDiet's own code,
 * not a model call, the thing that answers okx-a2a seller-session traffic
 * for Agent 9636.
 *
 * Why this exists: okx-a2a's own OpenClaw plugin (@okxweb3/a2a-openclaw)
 * turns every inbound XMTP message into a normal OpenClaw agent turn (its
 * `before_agent_run` hook just queues the message into the agent-run
 * pipeline — verified directly in the installed 0.1.10 plugin bundle, see
 * scripts/seller-runtime-supervisor.ts's module docblock). Left alone, that
 * agent turn would be answered by whatever model OpenClaw has configured —
 * which is exactly the prohibited "Claude/Codex/Cursor acting as RepoDiet"
 * topology this runtime must never produce, and would also simply fail if
 * no model-provider credential is configured at all.
 *
 * `before_agent_reply` is OpenClaw's documented, typed hook for exactly
 * this: "Short-circuit the model turn with a synthetic reply or silence"
 * (docs/plugins/hooks.md, docs/concepts/agent-loop.md; contract verified
 * directly against the installed openclaw@2026.7.1-2 SDK type declarations,
 * dist/hook-types-*.d.ts: `PluginHookBeforeAgentReplyEvent = { cleanedBody:
 * string }`, `PluginHookBeforeAgentReplyResult = { handled: boolean; reply?:
 * ReplyPayload; reason?: string }`, `ReplyPayload = { text?: string; ... }`).
 *
 * Scope in this pass: every message inside an okx-a2a seller session for
 * Agent 9636 (`sessionKey` matching `my:9636:to:<peer>`, the exact pattern
 * already proven in scripts/okx-runtime/repodiet-a2a-responder.ts) is
 * unconditionally claimed (`handled: true`) — either answered with the
 * same deterministic safe-message template already proven over the HTTP
 * intake path, or, for anything not yet recognized as a safe pre-work
 * message, answered with a deterministic escalation notice. Nothing in this
 * scope ever falls through to a real model call. Funded-task execution
 * (real analysis / real PR dispatch) is intentionally NOT handled here yet
 * — see docs/SELLER_RUNTIME_DEPLOYMENT.md for the concrete next step.
 *
 * All decision logic lives in logic.js, which has no dependency on the
 * "openclaw" package and is unit-tested directly (test/repodiet-a2a-bridge.
 * test.ts). This file is the thin adapter that only the real OpenClaw
 * runtime ever loads.
 *
 * This plugin is NOT yet wired into scripts/seller-runtime-supervisor.ts's
 * startup config calls. Loading it requires `plugins.load.paths` plus
 * `plugins.entries.repodiet-a2a-bridge.hooks.allowConversationAccess: true`
 * (required for any non-bundled plugin using a conversation hook — docs/
 * plugins/hooks.md). Wiring that in is deferred until a real container run
 * confirms `openclaw plugins inspect repodiet-a2a-bridge --runtime --json`
 * reports it loaded — activating an unverified plugin load inside the
 * fail-closed startup sequence risks turning a working gateway-ready path
 * into a new failure mode that cannot be exercised without a live gateway.
 */

// definePluginEntry is the documented plugin-entry contract (docs/plugins/
// building-plugins.md quickstart) — used as-is rather than a raw exported
// object so this plugin gets the same validation/typing every other
// OpenClaw plugin entry gets. Only this file (never logic.js) depends on
// the "openclaw" package, which is resolvable only inside a real OpenClaw
// runtime/container, not this repo's own node_modules.
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { decideReply } from "./logic.js";

export default definePluginEntry({
  id: "repodiet-a2a-bridge",
  name: "RepoDiet A2A Bridge",
  description:
    "Deterministically answers okx-a2a seller-session (Agent 9636) messages without an LLM turn.",
  register(api) {
    api.on("before_agent_reply", async (event, ctx) => decideReply(event, ctx));
  },
});
