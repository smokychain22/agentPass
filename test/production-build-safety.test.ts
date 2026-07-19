import assert from "node:assert/strict";
import {
  getPaymentEnvironment,
  MAINNET_NETWORK,
  MAINNET_USDT,
  TESTNET_NETWORK,
  TESTNET_USDT,
} from "../src/lib/payment/payment-environment";
import { getCanonicalOkxIdentity, isNextProductionBuild } from "../src/lib/okx/identity";

const originalEnv = { ...process.env };

async function withEnv(
  patch: Record<string, string | undefined>,
  fn: () => void | Promise<void>
) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  }
}

async function run(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

async function main() {
  console.log("production-build-safety");

  await run("Production + testnet mode is fail-closed misconfiguration", async () => {
    await withEnv(
      {
        VERCEL_ENV: "production",
        REPODIET_PAYMENT_MODE: "testnet",
        REPODIET_PAYMENT_NETWORK: TESTNET_NETWORK,
        REPODIET_PAYMENT_CHAIN_ID: "1952",
        REPODIET_PAYMENT_ASSET: TESTNET_USDT,
        NEXT_PHASE: undefined,
      },
      () => {
        const pe = getPaymentEnvironment();
        assert.equal(pe.productionTestnetMisconfig, true);
        assert.equal(pe.mainnetBlocked, true);
        assert.match(pe.blockReason || "", /PRODUCTION_TESTNET_MISCONFIGURATION/);
        const id = getCanonicalOkxIdentity();
        assert.equal(id.network, MAINNET_NETWORK);
        assert.equal(id.settlementAsset, MAINNET_USDT);
        assert.equal(id.productionTestnetMisconfig, true);
      }
    );
  });

  await run("identity conflicts throw at runtime but not during next build", async () => {
    await withEnv(
      {
        OKX_ASP_AGENT_ID: "5283",
        REPODIET_OKX_AGENT_ID: "9999",
        NEXT_PUBLIC_APP_URL: "https://skillswap-virid-kappa.vercel.app",
        NEXT_PHASE: undefined,
        VERCEL_ENV: "production",
        REPODIET_PAYMENT_MODE: undefined,
      },
      () => {
        assert.throws(() => getCanonicalOkxIdentity(), /okx_identity_conflict/);
      }
    );

    await withEnv(
      {
        OKX_ASP_AGENT_ID: "5283",
        REPODIET_OKX_AGENT_ID: "9999",
        NEXT_PUBLIC_APP_URL: "https://skillswap-virid-kappa.vercel.app",
        NEXT_PHASE: "phase-production-build",
        VERCEL_ENV: "production",
        REPODIET_PAYMENT_MODE: undefined,
      },
      () => {
        assert.equal(isNextProductionBuild(), true);
        const id = getCanonicalOkxIdentity();
        assert.equal(id.aspAgentId, 5283);
      }
    );
  });

  console.log("production-build-safety: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
