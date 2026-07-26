import assert from "node:assert/strict";
import {
  deriveAgentRuntimeHealth,
  getAgentRuntimeHealth,
  recordInboundTaskReceived,
  recordTaskAcknowledged,
  recordVerifiedAgentRuntimeHeartbeat,
  touchAgentRuntimeHealth,
  type AgentRuntimeHealth,
} from "../src/lib/a2a/agent-runtime-health";
import { POST as heartbeatPost } from "../src/app/api/internal/okx/seller-heartbeat/route";
import { deleteDurableRecord } from "../src/lib/store/durable-store";

const HEALTH_KEY = "agent_runtime_health";
const secret = "repodiet-heartbeat-test-secret-1234567890";

function verifiedInput() {
  return {
    aspAgentId: "5283",
    a2aServiceId: "32947",
    sellerWallet: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
    registeredCommunicationAddress: "0x185d96f1ccbae299263e789349028ef9569f9d22",
    recoveredSignerAddress: "0x185d96f1ccbae299263e789349028ef9569f9d22",
    onchainOsAuthenticated: true as const,
    officialWatchActive: true as const,
    xmtpClientReady: true as const,
    ttlSeconds: 60,
  };
}

async function run() {
  console.log("okx-agent-runtime-heartbeat");
  const previousSecret = process.env.REPODIET_OKX_RUNTIME_HEARTBEAT_SECRET;
  await deleteDurableRecord("marketplace_deliveries", HEALTH_KEY);

  try {
    process.env.REPODIET_OKX_RUNTIME_HEARTBEAT_SECRET = secret;

    await recordInboundTaskReceived();
    await recordTaskAcknowledged({ queueDepth: 0 });
    await touchAgentRuntimeHealth({ a2mcpEndpointHealthy: true });
    const observedOnly = await getAgentRuntimeHealth();
    assert.equal(observedOnly.agentOnline, false);
    assert.equal(observedOnly.onchainOsAuthenticated, false);
    assert.equal(observedOnly.heartbeatStatus, "missing");

    await assert.rejects(
      recordVerifiedAgentRuntimeHeartbeat({
        ...verifiedInput(),
        recoveredSignerAddress: "0x5f538722f11eae7cc3588507cd0d7162213c07ff",
      }),
      /official_seller_identity_mismatch/
    );

    const unauthorized = await heartbeatPost(
      new Request("https://repodiet.test/api/internal/okx/seller-heartbeat", {
        method: "POST",
        headers: {
          authorization: "Bearer wrong-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify(verifiedInput()),
      })
    );
    assert.equal(unauthorized.status, 401);

    const accepted = await heartbeatPost(
      new Request("https://repodiet.test/api/internal/okx/seller-heartbeat", {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(verifiedInput()),
      })
    );
    assert.equal(accepted.status, 200);
    const live = await getAgentRuntimeHealth();
    assert.equal(live.agentOnline, true);
    assert.equal(live.onchainOsAuthenticated, true);
    assert.equal(live.officialWatchActive, true);
    assert.equal(live.xmtpClientReady, true);
    assert.equal(live.heartbeatStatus, "fresh");

    const expiredStored: AgentRuntimeHealth = {
      ...live,
      heartbeatExpiresAt: "2026-01-01T00:00:00.000Z",
    };
    const expired = deriveAgentRuntimeHealth(
      expiredStored,
      Date.parse("2026-01-01T00:00:01.000Z")
    );
    assert.equal(expired.agentOnline, false);
    assert.equal(expired.heartbeatStatus, "expired");
    assert.equal(expired.alertAgentCannotAnswer, true);

    console.log("okx-agent-runtime-heartbeat: all passed");
  } finally {
    await deleteDurableRecord("marketplace_deliveries", HEALTH_KEY);
    if (previousSecret === undefined) {
      delete process.env.REPODIET_OKX_RUNTIME_HEARTBEAT_SECRET;
    } else {
      process.env.REPODIET_OKX_RUNTIME_HEARTBEAT_SECRET = previousSecret;
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
