import assert from "node:assert/strict";
import { buildOkxReadinessResponse } from "../src/lib/okx/readiness";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("okx-readiness");

test("never exposes API secret fields", () => {
  const prev = {
    OKX_API_KEY: process.env.OKX_API_KEY,
    OKX_SECRET_KEY: process.env.OKX_SECRET_KEY,
    OKX_PASSPHRASE: process.env.OKX_PASSPHRASE,
  };
  try {
    process.env.OKX_API_KEY = "test-key";
    process.env.OKX_SECRET_KEY = "test-secret";
    process.env.OKX_PASSPHRASE = "test-pass";
    const body = buildOkxReadinessResponse();
    const json = JSON.stringify(body);
    assert.equal(body.developerApi, true);
    assert.ok(!json.includes("test-secret"));
    assert.ok(!json.includes("test-pass"));
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

console.log("okx-readiness: all passed");
