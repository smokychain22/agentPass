import assert from "node:assert/strict";
import {
  encodeErc20Transfer,
  isLikelyTxHash,
  normalizeHexAddress,
} from "../src/lib/wallet/erc20-transfer";
import {
  ERC20_TRANSFER_TOPIC,
  matchUsdtTransferLog,
} from "../src/lib/payment/onchain-usdt";
import { resolveOkxAgentUrl } from "../src/lib/wallet/okx-agent-url";
import { X402_ASSET } from "../src/lib/payment/constants";

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
  console.log("live-browser-payment tests");

  await test("encodes ERC-20 transfer calldata for USDT amount", () => {
    const data = encodeErc20Transfer(
      "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
      "200000"
    );
    assert.equal(data.slice(0, 10), "0xa9059cbb");
    assert.equal(data.length, 10 + 64 + 64);
    assert.match(data, /1339724ada3adf04bb7a8ccc6498216214bbdf90/);
    assert.match(data, /30d40$/); // 200000 = 0x30d40
  });

  await test("rejects invalid addresses for transfer encoding", () => {
    assert.throws(() => encodeErc20Transfer("not-an-address", "1"));
  });

  await test("tx hash detection requires 66-char 0x hex", () => {
    assert.equal(
      isLikelyTxHash("0x" + "ab".repeat(32)),
      true
    );
    assert.equal(isLikelyTxHash("0x" + "ab".repeat(20)), false);
  });

  await test("Transfer log matcher binds payer, recipient, token, amount", () => {
    const payer = "0xaa895234c3fc31c40018eef975db6ac79bf87f1a";
    const recipient = "0x1339724ada3adf04bb7a8ccc6498216214bbdf90";
    const amountMicro = "1000000";
    const log = {
      address: X402_ASSET,
      topics: [
        ERC20_TRANSFER_TOPIC,
        "0x" + payer.slice(2).padStart(64, "0"),
        "0x" + recipient.slice(2).padStart(64, "0"),
      ],
      data: "0x" + BigInt(amountMicro).toString(16).padStart(64, "0"),
    };
    assert.equal(
      matchUsdtTransferLog({
        log,
        tokenAddress: X402_ASSET,
        payer,
        recipient,
        amountMicro,
      }),
      true
    );
    assert.equal(
      matchUsdtTransferLog({
        log,
        tokenAddress: X402_ASSET,
        payer,
        recipient,
        amountMicro: "2000000",
      }),
      false
    );
  });

  await test("client cannot substitute a different recipient in encoded call", () => {
    const intended = encodeErc20Transfer(
      "0x1339724ada3adf04bb7a8ccc6498216214bbdf90",
      "1000000"
    );
    const tampered = encodeErc20Transfer(
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      "1000000"
    );
    assert.notEqual(intended, tampered);
  });

  await test("OKX agent URL stays hidden unless explicitly configured", async () => {
    await withEnv(
      {
        NEXT_PUBLIC_OKX_AGENT_URL: undefined,
        NEXT_PUBLIC_OKX_AGENT_URL_AUTO: undefined,
      },
      async () => {
        assert.equal(resolveOkxAgentUrl(), null);
      }
    );
    await withEnv(
      {
        NEXT_PUBLIC_OKX_AGENT_URL: "https://www.okx.ai/agents/5283",
      },
      async () => {
        assert.equal(resolveOkxAgentUrl(), "https://www.okx.ai/agents/5283");
      }
    );
  });

  await test("normalizeHexAddress lowercases", () => {
    assert.equal(
      normalizeHexAddress("0xAA895234C3FC31C40018EEF975DB6AC79BF87F1A"),
      "0xaa895234c3fc31c40018eef975db6ac79bf87f1a"
    );
  });

  await test("live mode rejects non-tx payment references without facilitator", async () => {
    const prevRequire = process.env.REQUIRE_REAL_X402;
    const prevFacilitator = process.env.REPODIET_X402_FACILITATOR_URL;
    const prevTestMode = process.env.REPODIET_X402_TEST_MODE;
    const prevA2a = process.env.REPODIET_A2A_TEST_PRICE;
    process.env.REQUIRE_REAL_X402 = "1";
    delete process.env.REPODIET_X402_FACILITATOR_URL;
    delete process.env.REPODIET_X402_TEST_MODE;
    delete process.env.REPODIET_A2A_TEST_PRICE;
    try {
      const { createBoundQuote } = await import("../src/lib/payment/quote-service");
      const { verifyAndFundQuote } = await import("../src/lib/payment/settlement");
      const quote = await createBoundQuote({
        repository: "repodiet/demo-slop-app",
        branch: "main",
        commitSha: "abc123",
        findingIds: ["f1"],
        operation: "verified_cleanup_pr",
        sourceFileCount: 100,
      });
      // Non-test production price with a fake short reference must fail live verification.
      assert.notEqual(quote.amountMicro, "200000");
      const result = await verifyAndFundQuote({
        quoteId: quote.quoteId,
        paymentReference: "0xnotarealtx",
        payer: "0xaa895234c3fc31c40018eef975db6ac79bf87f1a",
        amountMicro: quote.amountMicro,
        currency: quote.currency,
        network: quote.network,
        recipient: quote.recipient,
        nonce: quote.nonce,
        idempotencyKey: `idem_live_${quote.quoteId}`,
        paymentSignature: "onchain:erc20_transfer",
      });
      assert.equal(result.ok, false);
      assert.match(String(result.reason ?? ""), /transaction hash|facilitator|on-chain|Live payment/i);
    } finally {
      if (prevRequire === undefined) delete process.env.REQUIRE_REAL_X402;
      else process.env.REQUIRE_REAL_X402 = prevRequire;
      if (prevFacilitator === undefined) delete process.env.REPODIET_X402_FACILITATOR_URL;
      else process.env.REPODIET_X402_FACILITATOR_URL = prevFacilitator;
      if (prevTestMode === undefined) delete process.env.REPODIET_X402_TEST_MODE;
      else process.env.REPODIET_X402_TEST_MODE = prevTestMode;
      if (prevA2a === undefined) delete process.env.REPODIET_A2A_TEST_PRICE;
      else process.env.REPODIET_A2A_TEST_PRICE = prevA2a;
    }
  });

  console.log("live-browser-payment: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
