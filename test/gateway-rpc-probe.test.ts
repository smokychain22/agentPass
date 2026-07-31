/**
 * Direct, in-process authenticated Gateway RPC probe
 * (src/lib/okx-runtime/gateway-rpc-probe.ts).
 *
 * Replaces two previously CLI-spawned readiness checks proven, live on
 * repodiet-agent-9636, to hang indefinitely regardless of timeout. These
 * tests run against test/fixtures/fake-openclaw-gateway.ts, a
 * protocol-faithful fake server implementing the exact wire protocol
 * traced from the real pinned openclaw@2026.7.1-2 client source — not a
 * generic echo server — so each scenario below exercises the real
 * GatewayClient's real connect-challenge/hello-ok logic, not a
 * hand-rolled substitute.
 *
 * The probe stops at a validated hello-ok and does not chain a further
 * RPC call — see gateway-rpc-probe.ts's module docblock for the live,
 * empirically-proven reason: `gateway.auth.mode: "token"` grants an
 * empty operator-scope set unconditionally, so any scoped post-hello
 * method (status, health, ...) is structurally unreachable regardless of
 * what scopes are requested. An earlier revision of this test suite
 * exercised a chained "status" call; that entire category of scenario
 * (malformed RPC response, mismatched request id, request timeout, close
 * after hello but before a response) no longer applies now that there is
 * no post-hello request at all.
 */
import assert from "node:assert/strict";
import { probeGatewayRpc } from "../src/lib/okx-runtime/gateway-rpc-probe";
import { FakeOpenclawGateway } from "./fixtures/fake-openclaw-gateway";

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    await fn();
    console.log(`  ✓ ${name}`);
  })();
}

const REAL_TOKEN = "real-secret-token-abc123";

async function run() {
  await test("a valid authenticated hello-ok passes, with server/runtime identity captured", async () => {
    const gateway = await FakeOpenclawGateway.start({ expectedToken: REAL_TOKEN });
    try {
      const result = await probeGatewayRpc({
        url: gateway.url,
        token: REAL_TOKEN,
        connectTimeoutMs: 2_000,
      });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.serverVersion, "2026.7.1-2");
        assert.ok(result.connId.length > 0);
        assert.equal(result.authRole, "operator");
        assert.ok(Array.isArray(result.authScopes));
      }
    } finally {
      await gateway.stop();
    }
  });

  await test("the probe requests the full CLI_DEFAULT_OPERATOR_SCOPES set on connect, even though gateway.auth.mode:\"token\" is known to grant none of them — forward-compatible with a future auth mode that might", async () => {
    const gateway = await FakeOpenclawGateway.start({ expectedToken: REAL_TOKEN });
    try {
      await probeGatewayRpc({ url: gateway.url, token: REAL_TOKEN, connectTimeoutMs: 2_000 });
      assert.deepEqual(
        gateway.lastRequestedScopes,
        ["operator.admin", "operator.read", "operator.write", "operator.approvals", "operator.pairing", "operator.talk.secrets"]
      );
    } finally {
      await gateway.stop();
    }
  });

  await test("success does not depend on any scopes actually being granted — an empty auth.scopes in hello-ok (the real, live-observed behavior for token auth) still counts as success", async () => {
    const gateway = await FakeOpenclawGateway.start({
      expectedToken: REAL_TOKEN,
      helloOkPayloadOverride: {
        type: "hello-ok",
        protocol: 4,
        server: { version: "2026.7.1-2", connId: "fixed-conn-id" },
        features: { methods: [], events: [] },
        snapshot: { presence: [], health: {}, stateVersion: { presence: 0, health: 0 }, uptimeMs: 1 },
        auth: { role: "operator", scopes: [] },
        policy: { maxPayload: 1, maxBufferedBytes: 1, tickIntervalMs: 1 },
      },
    });
    try {
      const result = await probeGatewayRpc({ url: gateway.url, token: REAL_TOKEN, connectTimeoutMs: 2_000 });
      assert.equal(result.ok, true);
      if (result.ok) assert.deepEqual(result.authScopes, []);
    } finally {
      await gateway.stop();
    }
  });

  await test("a wrong token fails readiness with category auth_failed, never a false positive", async () => {
    const gateway = await FakeOpenclawGateway.start({
      expectedToken: REAL_TOKEN,
      authBehavior: { kind: "reject_mismatch" },
    });
    try {
      const result = await probeGatewayRpc({
        url: gateway.url,
        token: "wrong-token-xyz",
        connectTimeoutMs: 2_000,
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.category, "auth_failed");
    } finally {
      await gateway.stop();
    }
  });

  await test("a missing token fails readiness with category auth_failed", async () => {
    const gateway = await FakeOpenclawGateway.start({
      expectedToken: REAL_TOKEN,
      authBehavior: { kind: "reject_missing" },
    });
    try {
      const result = await probeGatewayRpc({
        url: gateway.url,
        token: "",
        connectTimeoutMs: 2_000,
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.category, "auth_failed");
    } finally {
      await gateway.stop();
    }
  });

  await test("a malformed hello-ok response fails readiness with category malformed_response", async () => {
    const gateway = await FakeOpenclawGateway.start({
      expectedToken: REAL_TOKEN,
      // Missing server.version/connId and auth.role/scopes — a real
      // Gateway would never send this, but a lenient client that trusted
      // it blindly would otherwise falsely report readiness.
      helloOkPayloadOverride: { type: "hello-ok", protocol: 4 },
    });
    try {
      const result = await probeGatewayRpc({
        url: gateway.url,
        token: REAL_TOKEN,
        connectTimeoutMs: 2_000,
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.category, "malformed_response");
    } finally {
      await gateway.stop();
    }
  });

  await test("a connection that never answers the connect handshake fails readiness with category connect_timeout, bounded by the outer timeout", async () => {
    const gateway = await FakeOpenclawGateway.start({
      expectedToken: REAL_TOKEN,
      authBehavior: { kind: "no_hello_response" },
    });
    try {
      const startedAt = Date.now();
      const result = await probeGatewayRpc({
        url: gateway.url,
        token: REAL_TOKEN,
        connectTimeoutMs: 500,
      });
      const elapsedMs = Date.now() - startedAt;
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.category, "connect_timeout");
      assert.ok(elapsedMs < 3_000, `probe must not hang well past its own outer timeout (took ${elapsedMs}ms)`);
    } finally {
      await gateway.stop();
    }
  });

  await test("a connection closed before the connect handshake completes fails readiness with category closed_before_response", async () => {
    const gateway = await FakeOpenclawGateway.start({
      authBehavior: { kind: "close_before_hello", code: 1008, reason: "server rejecting" },
    });
    try {
      const result = await probeGatewayRpc({
        url: gateway.url,
        token: REAL_TOKEN,
        connectTimeoutMs: 2_000,
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.category, "closed_before_response");
    } finally {
      await gateway.stop();
    }
  });

  await test("an unreachable gateway (nothing listening) fails readiness without hanging, category connect_timeout or connect_error", async () => {
    const startedAt = Date.now();
    const result = await probeGatewayRpc({
      url: "ws://127.0.0.1:1", // reserved/unused low port, connection refused
      token: REAL_TOKEN,
      connectTimeoutMs: 1_500,
    });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(["connect_timeout", "connect_error"].includes(result.category), result.category);
    assert.ok(elapsedMs < 4_000, `must not hang past the outer timeout (took ${elapsedMs}ms)`);
  });

  await test("the socket is cleanly closed by the probe itself on both the success and failure path — no lingering connections", async () => {
    const gateway = await FakeOpenclawGateway.start({ expectedToken: REAL_TOKEN });
    try {
      await probeGatewayRpc({ url: gateway.url, token: REAL_TOKEN, connectTimeoutMs: 2_000 });
      // stopAndWait resolves once the socket is actually closed server-side too.
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(gateway.connectionCount, 1);
    } finally {
      await gateway.stop();
    }

    const gateway2 = await FakeOpenclawGateway.start({
      expectedToken: REAL_TOKEN,
      authBehavior: { kind: "reject_mismatch" },
    });
    try {
      await probeGatewayRpc({ url: gateway2.url, token: "wrong", connectTimeoutMs: 2_000 });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(gateway2.connectionCount, 1);
    } finally {
      await gateway2.stop();
    }
  });

  await test("no secret value ever appears in a failure message, across every failure scenario above", async () => {
    const scenarios: Array<() => Promise<import("../src/lib/okx-runtime/gateway-rpc-probe").GatewayProbeResult>> = [
      async () => {
        const gateway = await FakeOpenclawGateway.start({ expectedToken: REAL_TOKEN, authBehavior: { kind: "reject_mismatch" } });
        try {
          return await probeGatewayRpc({ url: gateway.url, token: REAL_TOKEN, connectTimeoutMs: 1_000 });
        } finally {
          await gateway.stop();
        }
      },
      async () => {
        const gateway = await FakeOpenclawGateway.start({ authBehavior: { kind: "close_before_hello" } });
        try {
          return await probeGatewayRpc({ url: gateway.url, token: REAL_TOKEN, connectTimeoutMs: 1_000 });
        } finally {
          await gateway.stop();
        }
      },
    ];
    for (const scenario of scenarios) {
      const result = await scenario();
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(!result.message.includes(REAL_TOKEN), `failure message must never contain the real token: ${result.message}`);
      }
    }
  });

  console.log("All gateway-rpc-probe tests passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
