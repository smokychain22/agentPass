/**
 * okx-a2a carries the SAME exchange under two different key encodings, and
 * which one arrives depends on the code path. Both are real, both were taken
 * verbatim from the live gateway logs on Machine 7845320c476008:
 *
 *   transport (A2A / okx-a2a CLI):
 *     job:0xe7ca8d67…:my:9636:to:8178
 *   gateway (what OpenClaw passes to before_agent_reply as ctx.sessionKey):
 *     agent:main:okx-a2a:group:okx-xmtp:my=9636&to=8178&job=0xe7ca8d67…
 *
 * Publishing a reply requires the TRANSPORT form (`okx-a2a xmtp-send
 * --session-key`), but the hook only ever receives the GATEWAY form. This
 * module is the single place that understands both, so no other file has to
 * guess which encoding it is holding.
 */

const TRANSPORT_KEY_PATTERN = /(?:^|:)job:([^:]+):my:([^:]+):to:([^:]+)$/;
const BARE_TRANSPORT_KEY_PATTERN = /(?:^|:)my:([^:]+):to:([^:]+)$/;
const GATEWAY_KEY_PATTERN = /[:&?]my=([^&]+)&to=([^&]+)(?:&job=([^&]+))?/;

/**
 * Parses either encoding into the same shape. Returns undefined for anything
 * that is not an agent-to-agent exchange (`backup:…`, `system-notification`,
 * `agent:main:main`), which must never be treated as one.
 */
export function parseSessionKey(sessionKey) {
  if (typeof sessionKey !== "string" || !sessionKey) return undefined;

  const gateway = sessionKey.match(GATEWAY_KEY_PATTERN);
  if (gateway) {
    return {
      encoding: "gateway",
      myAgentId: gateway[1],
      peerAgentId: gateway[2],
      jobId: gateway[3],
    };
  }

  const transport = sessionKey.match(TRANSPORT_KEY_PATTERN);
  if (transport) {
    return {
      encoding: "transport",
      jobId: transport[1],
      myAgentId: transport[2],
      peerAgentId: transport[3],
    };
  }

  const bare = sessionKey.match(BARE_TRANSPORT_KEY_PATTERN);
  if (bare) {
    return {
      encoding: "bare",
      jobId: undefined,
      myAgentId: bare[1],
      peerAgentId: bare[2],
    };
  }

  return undefined;
}

/**
 * Builds the transport-form key that `okx-a2a xmtp-send --session-key`
 * accepts. Returns undefined when there is no jobId, because a seller reply
 * without a job has nowhere legitimate to go — the A2A layer rejects it
 * ("task not found, rejected, completed, closed or expired"), and inventing
 * one would be fabricating a job that does not exist.
 */
export function toTransportSessionKey(parsed) {
  if (!parsed || !parsed.jobId || !parsed.myAgentId || !parsed.peerAgentId) return undefined;
  return `job:${parsed.jobId}:my:${parsed.myAgentId}:to:${parsed.peerAgentId}`;
}

/**
 * Normalized, non-secret shape descriptor for logs. Never emits the jobId or
 * any peer address — only which encoding was seen, so a future key-format
 * change is visible in the logs without leaking exchange identity.
 */
export function describeSessionKeyShape(sessionKey) {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) return "unrecognized";
  return parsed.jobId ? `${parsed.encoding}+job` : `${parsed.encoding}`;
}
