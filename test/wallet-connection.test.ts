import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isXLayerChainId,
  XLAYER_CAIP2,
  XLAYER_EVM_CHAIN_ID,
} from "../src/lib/wallet/chain-config";
import {
  isInternalTestBuyerAllowed,
  rejectInternalTestBuyerForCustomer,
} from "../src/lib/wallet/test-buyer-guard";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    await fn();
    console.log(`  ✓ ${name}`);
  })();
}

function withEnv(vars: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const prev: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    prev[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return (async () => {
    try {
      await fn();
    } finally {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  })();
}

async function run() {
  console.log("wallet-connection tests");

  await test("X Layer chain ID is 196", () => {
    assert.equal(XLAYER_EVM_CHAIN_ID, 196);
    assert.equal(XLAYER_CAIP2, "eip155:196");
    assert.equal(isXLayerChainId(196), true);
    assert.equal(isXLayerChainId("0xc4"), true);
    assert.equal(isXLayerChainId(1), false);
  });

  await test("internal test buyer blocked in production by default", async () => {
    await withEnv(
      {
        ALLOW_INTERNAL_TEST_BUYER: "1",
        VERCEL_ENV: "production",
        REPODIET_TEST_BUYER_ADDRESS: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      },
      async () => {
        assert.equal(isInternalTestBuyerAllowed(), false);
        const guard = rejectInternalTestBuyerForCustomer({
          payer: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        });
        assert.equal(guard.ok, false);
        if (!guard.ok) {
          assert.match(guard.reason, /Internal test buyer/);
        }
      }
    );
  });

  await test("internal test buyer allowed only in controlled test env", async () => {
    await withEnv(
      {
        ALLOW_INTERNAL_TEST_BUYER: "1",
        VERCEL_ENV: "preview",
        REPODIET_X402_TEST_MODE: "1",
        REPODIET_TEST_BUYER_ADDRESS: "0xabcabcabcabcabcabcabcabcabcabcabcabc",
      },
      async () => {
        assert.equal(isInternalTestBuyerAllowed(), true);
        const guard = rejectInternalTestBuyerForCustomer({
          payer: "0xabcabcabcabcabcabcabcabcabcabcabcabc",
        });
        assert.equal(guard.ok, false);
      }
    );
  });

  await test("customer payer unrelated to internal test buyer passes guard", async () => {
    await withEnv(
      {
        ALLOW_INTERNAL_TEST_BUYER: "0",
        REPODIET_TEST_BUYER_ADDRESS: "0xabcabcabcabcabcabcabcabcabcabcabcabc",
      },
      async () => {
        const guard = rejectInternalTestBuyerForCustomer({
          payer: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
        });
        assert.equal(guard.ok, true);
      }
    );
  });

  await test("wallet UI modules exist", () => {
    for (const file of [
      "src/components/wallet/wallet-provider.tsx",
      "src/components/wallet/connect-wallet-button.tsx",
      "src/components/wallet/customer-path-selector.tsx",
      "src/components/wallet/payment-authorization-panel.tsx",
      "src/lib/wallet/chain-config.ts",
      "src/lib/wallet/eip1193-provider.ts",
    ]) {
      assert.ok(fs.existsSync(path.join(ROOT, file)), file);
    }
  });

  await test("app shell includes wallet provider and connect button", () => {
    const page = fs.readFileSync(path.join(ROOT, "src/app/app/page.tsx"), "utf8");
    const topBar = fs.readFileSync(path.join(ROOT, "src/components/app/shell/app-top-bar.tsx"), "utf8");
    assert.match(page, /WalletProvider/);
    assert.match(topBar, /ConnectWalletButton/);
  });

  console.log("wallet-connection: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
