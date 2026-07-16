import assert from "node:assert/strict";
import { quoteCleanupPrPrice } from "../src/lib/pricing/quote";

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
  console.log("a2a-test-price");

  test("production A2A cleanup PR small repo is 1 USDT", () => {
    withEnv("REPODIET_A2A_TEST_PRICE", undefined, () => {
      const quote = quoteCleanupPrPrice(100);
      assert.equal(quote.amountMicro, "1000000");
      assert.equal(quote.amountUsdt, 1);
    });
  });

  test("test mode A2A cleanup PR is 0.20 USDT", () => {
    withEnv("ALLOW_INTERNAL_TEST_BUYER", "1", () => {
      withEnv("REPODIET_A2A_TEST_PRICE", "1", () => {
        const quote = quoteCleanupPrPrice(100);
        assert.equal(quote.amountMicro, "200000");
        assert.equal(quote.amountUsdt, 0.2);
      });
    });
  });

  test("A2A micro override is honored", () => {
    withEnv("ALLOW_INTERNAL_TEST_BUYER", "1", () => {
      withEnv("REPODIET_A2A_TEST_PRICE_MICRO", "150000", () => {
        const quote = quoteCleanupPrPrice(500);
        assert.equal(quote.amountMicro, "150000");
        assert.equal(quote.amountUsdt, 0.15);
      });
    });
  });

  test("production refuses the temporary test price even when stale variables remain", () => {
    withEnv("ALLOW_INTERNAL_TEST_BUYER", "1", () => {
      withEnv("VERCEL_ENV", "production", () => {
        withEnv("REPODIET_A2A_TEST_PRICE", "1", () => {
          const quote = quoteCleanupPrPrice(100);
          assert.equal(quote.amountMicro, "1000000");
        });
      });
    });
  });

  console.log("a2a-test-price: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
