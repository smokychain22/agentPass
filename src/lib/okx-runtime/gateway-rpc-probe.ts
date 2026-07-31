/**
 * Direct, in-process authenticated OpenClaw Gateway RPC probe.
 *
 * Replaces two previously CLI-spawned readiness checks (`openclaw gateway
 * health`, `openclaw gateway status --require-rpc`) that were proven, live
 * on repodiet-agent-9636, to hang indefinitely regardless of timeout — a
 * direct, bounded 120-second SSH test against `openclaw gateway health`
 * produced zero stdout/stderr and never returned control to the shell's
 * own `timeout` wrapper. Raising the CLI probes' own timeouts (10s/15s ->
 * 60s/60s) did not help either — every poll still exhausted the full 60s.
 *
 * This module reuses the REAL OpenClaw Gateway client —
 * `GatewayClient` exported from `openclaw/plugin-sdk/gateway-runtime`, the
 * exact same class the CLI itself constructs internally
 * (`gatewayCallDeps.createGatewayClient` in the CLI's own
 * `call-Bj6Erfmh.js`) — instead of spawning the CLI as a subprocess. The
 * connect challenge/handshake, request/response framing, and request-id
 * matching are all the client's own, traced directly from the pinned
 * openclaw 2026.7.1-2 package source (`src-DZzKBMa7.js`), not
 * reimplemented from a guessed protocol:
 *
 *   1. On WebSocket open, the server sends an event frame
 *      `{type:"event", event:"connect.challenge", payload:{nonce}}`.
 *   2. The client answers with a request frame
 *      `{type:"req", id:<uuid>, method:"connect", params:{auth:{token},
 *      role, scopes, client:{...}, ...}}`.
 *   3. The server responds `{type:"res", id, ok:true, payload:<HelloOk>}`
 *      on success, or `ok:false` with an error `code` such as
 *      `AUTH_TOKEN_MISSING`/`AUTH_TOKEN_MISMATCH` on failure — this is the
 *      actual authentication enforcement point. Unlike the Gateway's own
 *      HTTP probe routes (`/health`, `/ready`), there is no
 *      `isLocalDirectRequest` bypass for this WebSocket "connect" RPC, so
 *      reaching `hello-ok` at all is itself proof the configured token was
 *      genuinely accepted.
 *
 * === Why this probe stops at hello-ok and does not chain a further RPC
 * call (e.g. "status") — a real, live-discovered constraint, not a design
 * preference ===
 * An earlier revision of this module called `client.request("status", ...)`
 * after hello-ok, reasoning that "connect" alone might not prove a full
 * RPC round trip. Live in Docker, that failed every time with
 * `errorCode=INVALID_REQUEST errorMessage=missing scope: operator.read` —
 * even after explicitly requesting the full `CLI_DEFAULT_OPERATOR_SCOPES`
 * set in the "connect" params. Direct empirical testing against the real
 * running Gateway (four separate connect attempts, requesting
 * `["operator.admin"]`, `["operator.read"]`, all six known scopes, and no
 * `scopes` field at all) showed the server's own `hello-ok.auth.scopes`
 * came back `[]` in every single case: this Gateway's `gateway.auth.mode:
 * "token"` unconditionally grants an empty operator-scope set, regardless
 * of what the client requests. Traced into the real server source
 * (`server-methods-*.js`): every scoped method (including both "status"
 * and "health" — traced in `core-descriptors-*.js`, both require
 * `operator.read`) is checked via `authorizeOperatorScopesForMethod`,
 * which — with an empty granted-scope array — always reports the
 * required scope missing. There is no scope token auth can be granted
 * here to make a scoped method succeed. (The one live sighting of a
 * scoped call succeeding, `sessions.create` inside the okx-a2a plugin's
 * own separate connection, is explained by that method being marked
 * `startup: true` in the same descriptor table — a time-boxed startup-
 * grace exemption, not a scope grant — and is not something this probe,
 * running well after boot, can rely on either.)
 *
 * "connect" itself is not scope-gated (checking a scope before any scope
 * has been granted would be circular), and it already IS a genuine RPC
 * round trip in the exact same request/response frame format as every
 * other method — matched by the client-generated `id`, validated for a
 * real Gateway/runtime identity by `validateHelloOk` below. That is the
 * strongest signal this auth mode can produce, and this module treats it
 * as authoritative rather than chaining a call that is proven, live, to
 * always fail.
 */
import { GatewayClient } from "openclaw/plugin-sdk/gateway-runtime";
import { redactProcessOutput } from "./process-runner";

/** Canonical client identity values from openclaw's own client-info.ts registry (GATEWAY_CLIENT_IDS.PROBE / GATEWAY_CLIENT_MODES.PROBE) — inlined as literals rather than imported since that registry has no plugin-sdk export subpath, but both values are validated by the real server against a fixed allow-list of exactly these canonical strings. `mode: "probe"` also makes the server log any connect failure at debug rather than error level (traced in the client source: `this.opts.mode === GATEWAY_CLIENT_MODES.PROBE`), matching what this really is. */
const GATEWAY_PROBE_CLIENT_ID = "openclaw-probe";
const GATEWAY_PROBE_CLIENT_MODE = "probe";
const GATEWAY_PROBE_CLIENT_DISPLAY_NAME = "repodiet-seller-runtime-supervisor";
const GATEWAY_PROBE_ROLE = "operator";

/**
 * Requested for completeness and forward-compatibility (e.g. a future
 * password- or device-token-authenticated deployment might actually grant
 * some of these), even though live testing proved `gateway.auth.mode:
 * "token"` grants none of them today. Real values traced from openclaw's
 * own `src/gateway/method-scopes.ts` (`CLI_DEFAULT_OPERATOR_SCOPES`) —
 * not re-derived or guessed.
 */
const GATEWAY_PROBE_SCOPES = [
  "operator.admin",
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.pairing",
  "operator.talk.secrets",
];

export type GatewayProbeFailureCategory =
  | "connect_timeout"
  | "connect_error"
  | "auth_failed"
  | "closed_before_response"
  | "malformed_response"
  | "unknown";

export interface GatewayProbeSuccess {
  ok: true;
  serverVersion: string;
  connId: string;
  authRole: string;
  authScopes: string[];
  durationMs: number;
}

export interface GatewayProbeFailure {
  ok: false;
  category: GatewayProbeFailureCategory;
  /** Already redacted — safe to log verbatim. */
  message: string;
  durationMs: number;
}

export type GatewayProbeResult = GatewayProbeSuccess | GatewayProbeFailure;

export interface GatewayProbeParams {
  url: string;
  /** Read once by the caller from env — never persisted, never logged, never placed on argv. */
  token: string;
  /** Bounds the full connect -> authenticate -> hello-ok handshake. */
  connectTimeoutMs: number;
}

function redactMessage(message: string): string {
  return redactProcessOutput(message);
}

function errorMessage(err: unknown): string {
  return redactMessage(err instanceof Error ? err.message : String(err));
}

function gatewayErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const code = (err as { gatewayCode?: unknown }).gatewayCode;
  return typeof code === "string" ? code : undefined;
}

/** `onConnectError` fires for any failure of the "connect" RPC itself — the entire authenticate/handshake phase, including that RPC's own internal timeout. */
function categorizeConnectError(err: unknown): GatewayProbeFailureCategory {
  const code = gatewayErrorCode(err);
  if (code && /^AUTH_/.test(code)) return "auth_failed";
  const message = err instanceof Error ? err.message : String(err);
  if (/timeout/i.test(message)) return "connect_timeout";
  if (/gateway closed/i.test(message)) return "closed_before_response";
  return "connect_error";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validates that a successful `hello-ok` payload actually identifies a
 * real Gateway/runtime rather than being an empty or malformed object a
 * lenient client might otherwise accept. Fails closed on anything that
 * does not match the real HelloOk shape traced from the pinned package's
 * own schema (`schema-DtyqV_v0.d.ts`): `server.version`/`server.connId`
 * non-empty strings, `protocol` a positive integer, `auth.role` a
 * non-empty string, `auth.scopes` an array (possibly empty — see the
 * module docblock on why an empty array is expected under token auth,
 * not a failure).
 */
function validateHelloOk(hello: unknown): hello is {
  protocol: number;
  server: { version: string; connId: string };
  auth: { role: string; scopes: string[] };
} {
  if (!hello || typeof hello !== "object") return false;
  const h = hello as Record<string, unknown>;
  if (typeof h.protocol !== "number" || !Number.isInteger(h.protocol) || h.protocol <= 0) return false;
  const server = h.server;
  if (!server || typeof server !== "object") return false;
  if (!isNonEmptyString((server as Record<string, unknown>).version)) return false;
  if (!isNonEmptyString((server as Record<string, unknown>).connId)) return false;
  const auth = h.auth;
  if (!auth || typeof auth !== "object") return false;
  if (!isNonEmptyString((auth as Record<string, unknown>).role)) return false;
  if (!Array.isArray((auth as Record<string, unknown>).scopes)) return false;
  return true;
}

/**
 * Performs one connect -> authenticate -> clean disconnect round trip
 * against a live OpenClaw Gateway, entirely in-process (no subprocess
 * spawned). Always resolves (never rejects, never hangs past
 * `connectTimeoutMs` plus a small grace margin) with a categorized
 * result — this is a readiness probe, not a long-lived client, so it
 * always stops itself, on both the success and failure path, before
 * resolving.
 */
export async function probeGatewayRpc(params: GatewayProbeParams): Promise<GatewayProbeResult> {
  const startedAt = Date.now();

  return new Promise<GatewayProbeResult>((resolve) => {
    let settled = false;

    const finish = (result: GatewayProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      void client.stopAndWait({ timeoutMs: 1_000 }).catch(() => {
        // best-effort cleanup only — the result is already decided
      });
      resolve(result);
    };

    const client = new GatewayClient({
      url: params.url,
      token: params.token,
      deviceIdentity: null,
      clientName: GATEWAY_PROBE_CLIENT_ID,
      clientDisplayName: GATEWAY_PROBE_CLIENT_DISPLAY_NAME,
      mode: GATEWAY_PROBE_CLIENT_MODE,
      role: GATEWAY_PROBE_ROLE,
      scopes: GATEWAY_PROBE_SCOPES,
      onHelloOk: (hello) => {
        if (!validateHelloOk(hello)) {
          finish({
            ok: false,
            category: "malformed_response",
            message: "hello-ok payload did not match the expected Gateway/runtime shape",
            durationMs: Date.now() - startedAt,
          });
          return;
        }
        finish({
          ok: true,
          serverVersion: hello.server.version,
          connId: hello.server.connId,
          authRole: hello.auth.role,
          authScopes: hello.auth.scopes,
          durationMs: Date.now() - startedAt,
        });
      },
      onConnectError: (err) => {
        finish({
          ok: false,
          category: categorizeConnectError(err),
          message: errorMessage(err),
          durationMs: Date.now() - startedAt,
        });
      },
      onClose: (code, reason) => {
        finish({
          ok: false,
          category: "closed_before_response",
          message: redactMessage(`gateway closed (${code}): ${reason || "no reason"}`),
          durationMs: Date.now() - startedAt,
        });
      },
    });

    // Independent outer timeout: never trust the client's own internal
    // timeout machinery alone. The CLI's RPC transport was proven, live,
    // to hang past every internal timeout it had — root-caused to
    // something in the CLI's own wrapper, not GatewayClient itself, but
    // this module does not assume that root cause can never resurface
    // here, so it enforces its own hard ceiling regardless.
    const connectTimer = setTimeout(() => {
      finish({
        ok: false,
        category: "connect_timeout",
        message: `no authenticated response within ${params.connectTimeoutMs}ms`,
        durationMs: Date.now() - startedAt,
      });
    }, params.connectTimeoutMs);

    client.start();
  });
}
