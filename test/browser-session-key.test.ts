import assert from "node:assert/strict";
import { browserSessionFromKey } from "../src/lib/github-app/install-flow-store";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("browser-session-key");

test("extracts browser id from modern session key", () => {
  assert.equal(browserSessionFromKey("browser:abc123"), "abc123");
});

test("extracts browser id from legacy ip-prefixed session key", () => {
  assert.equal(browserSessionFromKey("203.0.113.4:abc123"), "abc123");
});

console.log("browser-session-key: all passed");
