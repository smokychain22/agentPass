/**
 * Guards the canonical buyer identity against regression.
 *
 * Agent 5295 is a superseded buyer. It survived in production not as an
 * explicit choice but as a FALLBACK: `api/a2a/preflight` ended its buyer
 * lookup with `|| "5295"`, and `REPODIET_OKX_BUYER_AGENT_ID` is not set in
 * every environment, so the superseded id was the value production actually
 * resolved on the endpoint that decides whether funding is safe.
 *
 * The runtime layout carried the same class of error twice over: the buyer
 * identity named 5295 AND claimed the seller's wallet as its own, and
 * `buildIsolatedRuntimeEnv` exports both to a child runtime.
 *
 * These tests assert the defaults directly — with the environment cleared —
 * because a default is exactly what nobody notices until it is wrong.
 */
import assert from "node:assert/strict";

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const CANONICAL_BUYER_AGENT_ID = 10466;
const CANONICAL_BUYER_WALLET = "0x1339724ada3adf04bb7a8ccc6498216214bbdf90";
const CANONICAL_SELLER_AGENT_ID = "9636";
const CANONICAL_SELLER_WALLET = "0xaa895234c3fc31c40018eef975db6ac79bf87f1a";

const FORBIDDEN_AGENT_IDS = ["5295", "5283"];

async function run() {
  console.log("okx canonical buyer identity");

  const buyerEnvNames = ["REPODIET_OKX_BUYER_AGENT_ID", "OKX_BUYER_AGENT_ID"];
  const saved = new Map(buyerEnvNames.map((n) => [n, process.env[n]]));
  for (const n of buyerEnvNames) delete process.env[n];

  const { getCanonicalOkxIdentity, DEFAULT_IDENTITY } = await import("../src/lib/okx/identity");
  const { OKX_RUNTIME_IDENTITIES, getRuntimePaths, buildIsolatedRuntimeEnv } = await import(
    "../src/lib/okx-runtime/runtime-layout"
  );

  await test("the canonical buyer default is 10466, with no env set", () => {
    assert.equal(DEFAULT_IDENTITY.buyerAgentId, CANONICAL_BUYER_AGENT_ID);
    assert.equal(getCanonicalOkxIdentity().buyerAgentId, CANONICAL_BUYER_AGENT_ID);
  });

  await test("the buyer wallet is the buyer's own, not the seller's", () => {
    assert.equal(DEFAULT_IDENTITY.buyerWallet, CANONICAL_BUYER_WALLET);
    assert.equal(getCanonicalOkxIdentity().buyerWallet, CANONICAL_BUYER_WALLET);
    assert.notEqual(
      getCanonicalOkxIdentity().buyerWallet,
      getCanonicalOkxIdentity().sellerWallet,
      "buyer and seller must not share a wallet address"
    );
  });

  await test("the seller identity is unchanged", () => {
    assert.equal(getCanonicalOkxIdentity().aspAgentId, 9636);
    assert.equal(getCanonicalOkxIdentity().sellerWallet, CANONICAL_SELLER_WALLET);
  });

  await test("an explicit env override still wins", () => {
    process.env.REPODIET_OKX_BUYER_AGENT_ID = "12345";
    try {
      assert.equal(getCanonicalOkxIdentity().buyerAgentId, 12345);
    } finally {
      delete process.env.REPODIET_OKX_BUYER_AGENT_ID;
    }
  });

  await test("conflicting buyer env names are rejected rather than silently picked", () => {
    process.env.REPODIET_OKX_BUYER_AGENT_ID = "10466";
    process.env.OKX_BUYER_AGENT_ID = "5295";
    try {
      assert.throws(() => getCanonicalOkxIdentity(), /okx_identity_conflict/);
    } finally {
      delete process.env.REPODIET_OKX_BUYER_AGENT_ID;
      delete process.env.OKX_BUYER_AGENT_ID;
    }
  });

  await test("runtime buyer identity is 10466 with its own wallet", () => {
    const buyer = OKX_RUNTIME_IDENTITIES.buyer;
    assert.equal(buyer.agentId, String(CANONICAL_BUYER_AGENT_ID));
    assert.equal(buyer.walletAddress, CANONICAL_BUYER_WALLET);
    assert.notEqual(buyer.walletAddress, OKX_RUNTIME_IDENTITIES.seller.walletAddress);
  });

  await test("runtime seller identity is unchanged", () => {
    assert.equal(OKX_RUNTIME_IDENTITIES.seller.agentId, CANONICAL_SELLER_AGENT_ID);
    assert.equal(OKX_RUNTIME_IDENTITIES.seller.walletAddress, CANONICAL_SELLER_WALLET);
  });

  await test("no runtime identity is a forbidden historical agent", () => {
    for (const identity of Object.values(OKX_RUNTIME_IDENTITIES)) {
      assert.ok(
        !FORBIDDEN_AGENT_IDS.includes(identity.agentId),
        `forbidden agent id in runtime identities: ${identity.agentId}`
      );
    }
  });

  await test("the buyer runtime root is derived from 10466", () => {
    const paths = getRuntimePaths("/tmp/okx", "buyer");
    assert.ok(
      paths.root.replace(/\\/g, "/").endsWith("buyer-10466"),
      `buyer root should end in buyer-10466, got ${paths.root}`
    );
    for (const forbidden of FORBIDDEN_AGENT_IDS) {
      assert.ok(!paths.root.includes(forbidden), `buyer root leaks ${forbidden}`);
    }
  });

  await test("a buyer child runtime is told 10466 and the buyer wallet", () => {
    const paths = getRuntimePaths("/tmp/okx", "buyer");
    const env = buildIsolatedRuntimeEnv(process.env, paths, OKX_RUNTIME_IDENTITIES.buyer);
    assert.equal(env.REPODIET_OKX_AGENT_ID, String(CANONICAL_BUYER_AGENT_ID));
    assert.equal(env.REPODIET_OKX_WALLET_ADDRESS, CANONICAL_BUYER_WALLET);
    assert.equal(env.REPODIET_OKX_RUNTIME_ROLE, "buyer");
  });

  await test("a seller child runtime is still told 9636 and the seller wallet", () => {
    const paths = getRuntimePaths("/tmp/okx", "seller");
    const env = buildIsolatedRuntimeEnv(process.env, paths, OKX_RUNTIME_IDENTITIES.seller);
    assert.equal(env.REPODIET_OKX_AGENT_ID, CANONICAL_SELLER_AGENT_ID);
    assert.equal(env.REPODIET_OKX_WALLET_ADDRESS, CANONICAL_SELLER_WALLET);
  });

  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  console.log("okx canonical buyer identity: all assertions passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
