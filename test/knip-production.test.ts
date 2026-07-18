import assert from "node:assert/strict";
import { knipChildEnv, isKnipOomError } from "../src/lib/findings/analyzer-child-env";
import { runKnip } from "../src/lib/findings/run-knip";
import path from "node:path";
import fs from "node:fs/promises";

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ ${name}`);
      throw err;
    }
  })();
}

async function run() {
  console.log("Knip production execution tests");

  await test("knipChildEnv disables raw transfer", () => {
    const env = knipChildEnv();
    assert.equal(env.KNIP_DISABLE_RAW_TRANSFER, "1");
    assert.ok(env.NODE_PATH);
  });

  await test("isKnipOomError detects oxc-parser allocation failure", () => {
    assert.equal(
      isKnipOomError("RangeError: Array buffer allocation failed\n  at createBuffer"),
      true
    );
    assert.equal(isKnipOomError("normal stderr"), false);
  });

  await test("runKnip returns native ok on e2e-fixture", async () => {
    const root = path.join(process.cwd(), "e2e-fixture");
    const result = await runKnip(root);
    assert.equal(result.status, "ok", result.error ?? "expected native knip");
    assert.equal(result.sourceMode, "native");
    assert.ok(result.report);
  });

  await test("runKnip uses import-graph fallback without package.json", async () => {
    const tmp = await fs.mkdtemp(path.join(process.cwd(), ".knip-test-"));
    try {
      const result = await runKnip(tmp);
      // Phase 1: missing package.json skips native Knip and uses import-graph fallback.
      // Fail-closed only when the fallback itself fails.
      assert.equal(result.status, "fallback");
      assert.equal(result.sourceMode, "fallback");
      assert.ok(result.report);
      assert.match(result.error ?? "", /import-graph fallback/i);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
}

run().then(() => console.log("knip-production.test.ts: ok"));
