import assert from "node:assert/strict";
import {
  ANALYZE_REPOSITORY_PRICE_PRODUCTION,
  ANALYZE_REPOSITORY_PRICE_TEST,
  getAnalyzeRepositoryPrice,
} from "../src/lib/payment/analyze-repository-price";
import { priceForOperation } from "../src/lib/payment/quote-service";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function withEnv(key: string, value: string | undefined, fn: () => void) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

async function run() {
  console.log("analyze-repository-price");

  test("production default is 0.03 USDT", () => {
    withEnv("REPODIET_A2MCP_TEST_PRICE", undefined, () => {
      withEnv("REPODIET_A2MCP_TEST_PRICE_MICRO", undefined, () => {
        const price = getAnalyzeRepositoryPrice();
        assert.deepEqual(price, ANALYZE_REPOSITORY_PRICE_PRODUCTION);
        assert.equal(priceForOperation("analyze_repository").amountMicro, "30000");
      });
    });
  });

  test("test mode is 0.01 USDT", () => {
    withEnv("REPODIET_A2MCP_TEST_PRICE", "1", () => {
      const price = getAnalyzeRepositoryPrice();
      assert.deepEqual(price, ANALYZE_REPOSITORY_PRICE_TEST);
    });
  });

  test("micro override is honored", () => {
    withEnv("REPODIET_A2MCP_TEST_PRICE_MICRO", "5000", () => {
      const price = getAnalyzeRepositoryPrice();
      assert.equal(price.amountMicro, "5000");
      assert.equal(price.priceLabel, "0.005 USDT");
    });
  });

  console.log("analyze-repository-price: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
