import assert from "node:assert/strict";
import {
  MAINNET_NETWORK,
  MAINNET_USDT,
  TESTNET_NETWORK,
  TESTNET_USDT,
  assertTestnetPaymentSafe,
  getPaymentEnvironment,
  resolvePaymentMode,
} from "../src/lib/payment/payment-environment";

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
  console.log("payment-environment");

  await run("unset defaults to mainnet material without claiming testnet", async () => {
    await withEnv(
      {
        REPODIET_PAYMENT_MODE: undefined,
        REPODIET_PAYMENT_NETWORK: undefined,
        REPODIET_PAYMENT_ASSET: undefined,
        REPODIET_X402_NETWORK: undefined,
        REPODIET_X402_ASSET: undefined,
      },
      () => {
        assert.equal(resolvePaymentMode(), "unset");
        const pe = getPaymentEnvironment();
        assert.equal(pe.network, MAINNET_NETWORK);
        assert.equal(pe.asset, MAINNET_USDT);
        assert.equal(pe.isTestnet, false);
        assert.equal(pe.mainnetBlocked, false);
      }
    );
  });

  await run("explicit testnet mode resolves test USD₮0 and blocks mainnet mix", async () => {
    await withEnv(
      {
        REPODIET_PAYMENT_MODE: "testnet",
        REPODIET_PAYMENT_NETWORK: TESTNET_NETWORK,
        REPODIET_PAYMENT_CHAIN_ID: "1952",
        REPODIET_PAYMENT_ASSET: TESTNET_USDT,
      },
      () => {
        const pe = getPaymentEnvironment();
        assert.equal(pe.paymentMode, "testnet");
        assert.equal(pe.environment, "testnet");
        assert.equal(pe.network, TESTNET_NETWORK);
        assert.equal(pe.chainId, 1952);
        assert.equal(pe.asset, TESTNET_USDT);
        assert.equal(pe.isTestnet, true);
        assert.equal(pe.mainnetBlocked, false);
        assert.doesNotThrow(() => assertTestnetPaymentSafe());
      }
    );
  });

  await run("testnet mode with mainnet asset fails closed", async () => {
    await withEnv(
      {
        REPODIET_PAYMENT_MODE: "testnet",
        REPODIET_PAYMENT_NETWORK: TESTNET_NETWORK,
        REPODIET_PAYMENT_ASSET: MAINNET_USDT,
      },
      () => {
        const pe = getPaymentEnvironment();
        assert.equal(pe.mainnetBlocked, true);
        assert.match(pe.blockReason || "", /MAINNET_CONFIGURATION_DETECTED/);
        assert.throws(() => assertTestnetPaymentSafe(), /MAINNET_CONFIGURATION_DETECTED/);
      }
    );
  });

  await run("assertTestnetPaymentSafe requires explicit testnet mode", async () => {
    await withEnv({ REPODIET_PAYMENT_MODE: undefined }, () => {
      assert.throws(() => assertTestnetPaymentSafe(), /OWNER_ACTION_REQUIRED/);
    });
  });

  console.log("payment-environment: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
