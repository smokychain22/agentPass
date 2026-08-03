/**
 * Identity and model of the isolated OpenClaw agent that executes official OKX
 * system-event turns.
 *
 * These live here, in a module with NO dependencies, rather than in
 * scripts/seller-runtime-supervisor.ts, because both the supervisor and the
 * seller runtime need them. The supervisor's own import graph reaches
 * `openclaw/plugin-sdk/gateway-runtime` (via gateway-rpc-probe), whose bundled
 * undici calls `webidl.util.markAsUncloneable` — a Node 22+ API. Importing the
 * supervisor just to read two string constants therefore dragged the entire
 * Gateway client into the seller runtime's startup path, and into any test that
 * touched it, where it crashes outright on Node 20.
 *
 * Keeping them dependency-free means one source of truth without that coupling.
 */

/**
 * The isolated OpenClaw agent that executes official OKX system-event turns —
 * and the ONLY identity in this deployment bound to a model.
 *
 * Why isolated rather than just setting a default: `next-action`'s output is an
 * instruction prompt for a reasoning agent, so the OKX lifecycle genuinely needs
 * a model. Ordinary buyer chat does not, and must not get one — RepoDiet's
 * deterministic bridge owns repository negotiation, findings, exact-file
 * approval and PR delivery. `openclaw agents add --model` binds a model to this
 * agent alone, leaving the `main` agent's global default untouched at
 * openai/gpt-5.5, so there is no path by which a buyer message reaches Gemini.
 */
export const OKX_SYSTEM_EVENT_AGENT_ID = "okx-system-events";

/**
 * Pinned per-agent, never as a global default.
 *
 * gemini-2.5-flash is deliberately NOT used: verified live against the
 * production credential, Google returns
 * `404 ... models/gemini-2.5-flash is no longer available to new users`.
 * 3.5-flash is the current flash tier and returned a real 200 with correct
 * instruction-following and tool use from this machine.
 */
export const OKX_SYSTEM_EVENT_MODEL = "google/gemini-3.5-flash";
