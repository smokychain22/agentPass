/**
 * Protocol-faithful fake OpenClaw Gateway WebSocket server, for
 * deterministic unit tests of src/lib/okx-runtime/gateway-rpc-probe.ts.
 *
 * The wire protocol implemented here is not guessed — it is traced
 * directly from the pinned openclaw@2026.7.1-2 package's own real client
 * source (packages/gateway-client/src/client.ts, bundled as
 * dist/src-DZzKBMa7.js in the extracted package):
 *
 *   1. On connection open, the server sends an event frame:
 *      {type:"event", event:"connect.challenge", payload:{nonce}}
 *   2. The client replies with a request frame:
 *      {type:"req", id, method:"connect", params:{auth:{token,...}, ...}}
 *   3. The server answers {type:"res", id, ok:true, payload:<HelloOk>} on
 *      success, or ok:false with an error `code` (e.g.
 *      "AUTH_TOKEN_MISSING") on failure — this is the actual
 *      authentication enforcement point for the real protocol.
 *
 * The probe stops at hello-ok (see gateway-rpc-probe.ts's module
 * docblock for why: live testing proved `gateway.auth.mode: "token"`
 * grants an empty operator-scope set unconditionally, making every
 * scoped post-hello RPC method unreachable regardless of what scopes are
 * requested), so this fake server only needs to model the connect
 * handshake, not a post-hello request/response.
 */
import { WebSocketServer, type WebSocket, type RawData } from "ws";
import { randomUUID } from "node:crypto";

export interface RequestFrame {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
}

export interface ConnectParams {
  auth?: { token?: string; password?: string };
  role?: string;
  scopes?: string[];
}

export type AuthBehavior =
  | { kind: "accept" }
  | { kind: "reject_missing" }
  | { kind: "reject_mismatch" }
  | { kind: "no_hello_response" }
  | { kind: "close_before_hello"; code?: number; reason?: string };

export interface FakeGatewayOptions {
  expectedToken?: string;
  authBehavior?: AuthBehavior;
  /** Delay (ms) before sending the connect.challenge event; 0 by default. */
  challengeDelayMs?: number;
  /** Overrides the well-formed hello-ok payload on an accepted connect — for testing malformed-response handling. */
  helloOkPayloadOverride?: Record<string, unknown>;
}

function helloOkPayload(): Record<string, unknown> {
  return {
    type: "hello-ok",
    protocol: 4,
    server: { version: "2026.7.1-2", connId: randomUUID() },
    features: { methods: ["health", "status"], events: ["tick"] },
    snapshot: {
      presence: [],
      health: {},
      stateVersion: { presence: 0, health: 0 },
      uptimeMs: 1234,
    },
    // Matches live-observed reality for gateway.auth.mode: "token": an
    // empty granted scope set regardless of what the client requested.
    auth: { role: "operator", scopes: [], issuedAtMs: Date.now() },
    policy: { maxPayload: 25 * 1024 * 1024, maxBufferedBytes: 1024 * 1024, tickIntervalMs: 30_000 },
  };
}

export class FakeOpenclawGateway {
  private readonly wss: WebSocketServer;
  readonly port: number;
  private readonly opts: FakeGatewayOptions;
  connectionCount = 0;
  /** The `scopes` array from the most recent accepted "connect" request's params — lets tests assert what the client actually requested, independent of what gets granted. */
  lastRequestedScopes: string[] | undefined;

  private constructor(wss: WebSocketServer, port: number, opts: FakeGatewayOptions) {
    this.wss = wss;
    this.port = port;
    this.opts = opts;
  }

  static async start(opts: FakeGatewayOptions = {}): Promise<FakeOpenclawGateway> {
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve, reject) => {
      wss.once("listening", () => resolve());
      wss.once("error", reject);
    });
    const address = wss.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    const server = new FakeOpenclawGateway(wss, port, opts);
    wss.on("connection", (socket) => server.handleConnection(socket));
    return server;
  }

  get url(): string {
    return `ws://127.0.0.1:${this.port}`;
  }

  private handleConnection(socket: WebSocket): void {
    this.connectionCount += 1;
    const authBehavior = this.opts.authBehavior ?? { kind: "accept" };

    if (authBehavior.kind === "close_before_hello") {
      socket.close(authBehavior.code ?? 1008, authBehavior.reason ?? "closed before hello");
      return;
    }

    const nonce = randomUUID();
    const sendChallenge = () => {
      socket.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce } }));
    };
    if (this.opts.challengeDelayMs) {
      setTimeout(sendChallenge, this.opts.challengeDelayMs);
    } else {
      sendChallenge();
    }

    let helloSent = false;

    socket.on("message", (raw: RawData) => {
      let frame: RequestFrame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (frame.type !== "req" || frame.method !== "connect") return;
      if (helloSent) return;
      if (authBehavior.kind === "no_hello_response") return;

      const params = (frame.params ?? {}) as ConnectParams;
      this.lastRequestedScopes = params.scopes;
      const providedToken = params.auth?.token;
      const tokenOk =
        authBehavior.kind === "accept"
          ? this.opts.expectedToken === undefined || providedToken === this.opts.expectedToken
          : false;
      if (!tokenOk) {
        const code = authBehavior.kind === "reject_missing" && !providedToken ? "AUTH_TOKEN_MISSING" : "AUTH_TOKEN_MISMATCH";
        socket.send(
          JSON.stringify({
            type: "res",
            id: frame.id,
            ok: false,
            error: { code, message: `${code}: token rejected by fake gateway`, retryable: false },
          })
        );
        return;
      }
      helloSent = true;
      socket.send(
        JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: this.opts.helloOkPayloadOverride ?? helloOkPayload(),
        })
      );
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.wss.close((err) => (err ? reject(err) : resolve()));
      for (const client of this.wss.clients) client.terminate();
    });
  }
}
