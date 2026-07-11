import assert from "node:assert/strict";
import { hashSource } from "../src/lib/execution/transform-audit";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("cleanup-delivery-guard");

test("baseline content hash is stable for delivery drift checks", () => {
  const source = 'import type { TrendingToken } from "./dexscreener";\n';
  const a = hashSource(source);
  const b = hashSource(source);
  assert.equal(a, b);
  assert.notEqual(a, hashSource(source + "\n"));
});

console.log("cleanup-delivery-guard: all passed");
