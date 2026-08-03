/**
 * Official OKX system events arrive here, and must not be answered here.
 *
 * The okx-a2a OpenClaw plugin turns every inbound message into an agent turn,
 * including the protocol's own system envelopes
 * (`{ agentId, message: { source: "system", event, jobId, ... } }`). Before
 * this module existed those envelopes hit `decideReply`, failed the seller
 * session-key match, and fell through to the model — which in this deployment
 * is the stock `openai/gpt-5.5` that does not exist here, so the run died
 * `state=error` and the official lifecycle silently never advanced.
 *
 * A system event is not chat and this plugin cannot execute it: acting on one
 * means running `onchainos agent next-action`, an authorization boundary, a
 * durable ledger and possibly an on-chain transaction, all of which live in the
 * seller runtime process. So the bridge does exactly two things — claim the
 * turn so it can never reach a model, and hand the envelope to the runtime
 * through the durable spool on the shared volume.
 *
 * The check below is deliberately STRUCTURAL and deliberately minimal. It is a
 * transport shim, not the trust boundary: everything it spools is re-validated
 * from scratch by src/lib/okx-runtime/system-event-intake before it can execute
 * or be acknowledged. Being minimal here means there is no second, divergent
 * copy of the authorization rules to drift out of sync with the real one.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Mirrors src/lib/okx-runtime/system-event-intake.MAX_ENVELOPE_BYTES. */
const MAX_ENVELOPE_BYTES = 32_768;
const SELLER_AGENT_ID = "9636";
const JOB_ID_PATTERN = /^0x[0-9a-f]{64}$/i;

/**
 * Resolves the seller runtime's spool directory from the same environment the
 * runtime itself reads, so the two agree without a shared constant.
 */
export function systemEventInboxDirectory(env = process.env) {
  const root =
    (env.REPODIET_OKX_RUNTIME_ROOT && env.REPODIET_OKX_RUNTIME_ROOT.trim()) ||
    "/persistent/data/okx-runtimes";
  return path.join(root, `seller-${SELLER_AGENT_ID}`, "data", "system-events", "inbox");
}

/**
 * Returns the envelope only when the body positively proves itself to be an
 * official system event addressed to this provider. Anything else — ordinary
 * buyer chat, prose that merely mentions a job, a system event for another
 * agent — returns undefined and takes the existing deterministic path.
 */
export function parseOfficialSystemEnvelope(body) {
  if (typeof body !== "string") return undefined;
  const trimmed = body.trim();
  if (!trimmed.startsWith("{")) return undefined;
  if (Buffer.byteLength(trimmed, "utf8") > MAX_ENVELOPE_BYTES) return undefined;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;

  // Agent-to-agent chat is the deterministic bridge's own territory and is
  // checked first, so a chat envelope can never be mistaken for a system one.
  if (parsed.msgType === "a2a-agent-chat") return undefined;

  const message = parsed.message;
  if (!message || typeof message !== "object") return undefined;
  if (message.source !== "system") return undefined;
  if (typeof message.event !== "string" || !message.event.trim()) return undefined;
  if (typeof message.jobId !== "string" || !JOB_ID_PATTERN.test(message.jobId.trim())) {
    return undefined;
  }
  // An envelope with no explicit addressee, or one addressed elsewhere, is
  // never spooled as ours.
  if (parsed.agentId === undefined || String(parsed.agentId) !== SELLER_AGENT_ID) {
    return undefined;
  }

  return parsed;
}

/**
 * Writes one envelope into the spool, atomically (temp + rename), so the
 * runtime can never read a half-written file. Keyed on the inbound transport
 * identity when one is available, so an exact redelivery lands on the same
 * filename and collapses onto the same ledger record instead of queueing twice.
 */
export function spoolSystemEvent(envelope, options = {}) {
  const directory = options.directory ?? systemEventInboxDirectory(options.env);
  fs.mkdirSync(directory, { recursive: true });

  const identity =
    options.transportId ??
    crypto.createHash("sha256").update(JSON.stringify(envelope)).digest("hex").slice(0, 32);
  const name = String(identity).replace(/[^A-Za-z0-9._-]/g, "_");
  const file = path.join(directory, `${name}.json`);
  const temporary = `${file}.${process.pid}.tmp`;

  fs.writeFileSync(temporary, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
  return file;
}
