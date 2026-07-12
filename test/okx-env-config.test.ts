import assert from "node:assert/strict";
import { aspAgentId, payToAddress, hasOkxPaymentSdkCredentials } from "../src/lib/okx/env-config";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("okx-env-config");

test("payToAddress prefers REPODIET_PAY_TO then PAY_TO_ADDRESS", () => {
  const keys = ["REPODIET_PAY_TO", "PAY_TO_ADDRESS", "OKX_AGENTIC_WALLET_ADDRESS"] as const;
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    delete process.env.REPODIET_PAY_TO;
    delete process.env.PAY_TO_ADDRESS;
    process.env.OKX_AGENTIC_WALLET_ADDRESS = "0xabc";
    assert.equal(payToAddress(), "0xabc");
    process.env.PAY_TO_ADDRESS = "0xdef";
    assert.equal(payToAddress(), "0xdef");
    process.env.REPODIET_PAY_TO = "0x111";
    assert.equal(payToAddress(), "0x111");
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
});

test("aspAgentId reads OKX_ASP_AGENT_ID alias", () => {
  const prev = process.env.OKX_ASP_AGENT_ID;
  try {
    process.env.OKX_ASP_AGENT_ID = "asp_test";
    assert.equal(aspAgentId(), "asp_test");
  } finally {
    if (prev === undefined) delete process.env.OKX_ASP_AGENT_ID;
    else process.env.OKX_ASP_AGENT_ID = prev;
  }
});

test("hasOkxPaymentSdkCredentials requires all three keys", () => {
  const keys = ["OKX_API_KEY", "OKX_SECRET_KEY", "OKX_PASSPHRASE"] as const;
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    assert.equal(hasOkxPaymentSdkCredentials(), false);
    process.env.OKX_API_KEY = "k";
    process.env.OKX_SECRET_KEY = "s";
    process.env.OKX_PASSPHRASE = "p";
    assert.equal(hasOkxPaymentSdkCredentials(), true);
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
});

console.log("okx-env-config: all passed");
