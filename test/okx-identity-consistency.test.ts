import assert from "node:assert/strict";
import test from "node:test";
import { getCanonicalOkxIdentity } from "../src/lib/okx/identity";

const managedNames = [
  "OKX_ASP_AGENT_ID",
  "NEXT_PUBLIC_OKX_ASP_AGENT_ID",
  "OKX_A2A_SERVICE_ID",
  "NEXT_PUBLIC_OKX_A2A_SERVICE_ID",
  "OKX_A2MCP_SERVICE_ID",
  "NEXT_PUBLIC_OKX_A2MCP_SERVICE_ID",
  "OKX_AGENTIC_WALLET_ADDRESS",
  "PAY_TO_ADDRESS",
  "REPODIET_PAY_TO",
] as const;

function withEnvironment(values: Partial<Record<(typeof managedNames)[number], string>>, run: () => void) {
  const previous = Object.fromEntries(managedNames.map((name) => [name, process.env[name]]));
  try {
    for (const name of managedNames) delete process.env[name];
    for (const [name, value] of Object.entries(values)) process.env[name] = value;
    run();
  } finally {
    for (const name of managedNames) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("canonical OKX identity accepts consistent aliases", () => {
  withEnvironment({
    OKX_ASP_AGENT_ID: "5283",
    NEXT_PUBLIC_OKX_ASP_AGENT_ID: "5283",
    OKX_A2A_SERVICE_ID: "32947",
    NEXT_PUBLIC_OKX_A2A_SERVICE_ID: "32947",
    OKX_AGENTIC_WALLET_ADDRESS: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
    PAY_TO_ADDRESS: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
  }, () => {
    const identity = getCanonicalOkxIdentity();
    assert.equal(identity.aspAgentId, 5283);
    assert.equal(identity.a2aServiceId, 32947);
    assert.equal(identity.sellerWallet, "0x1339724ada3adf04bb7a8ccc6498216214bbdf90");
  });
});

test("canonical OKX identity rejects conflicting server and public IDs", () => {
  withEnvironment({
    OKX_A2A_SERVICE_ID: "32947",
    NEXT_PUBLIC_OKX_A2A_SERVICE_ID: "32913",
  }, () => {
    assert.throws(() => getCanonicalOkxIdentity(), /okx_identity_conflict/);
  });
});

test("canonical OKX identity rejects conflicting payment recipients", () => {
  withEnvironment({
    OKX_AGENTIC_WALLET_ADDRESS: "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
    PAY_TO_ADDRESS: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
  }, () => {
    assert.throws(() => getCanonicalOkxIdentity(), /okx_identity_conflict/);
  });
});

console.log("okx-identity-consistency.test.ts: ok");
