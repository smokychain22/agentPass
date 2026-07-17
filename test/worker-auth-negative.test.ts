import assert from "node:assert/strict";
import { validateWorkerApiKey, assertWorkerAuthorized, WorkerAuthError } from "../src/lib/worker/worker-auth";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("worker-auth-negative");

const prev = process.env.WORKER_API_KEY;
process.env.WORKER_API_KEY = "test-worker-key-exactly-32chars!!";

test("missing Authorization → invalid", () => {
  assert.equal(validateWorkerApiKey(null), false);
  assert.throws(
    () => assertWorkerAuthorized(new Request("https://example.com/api/internal/worker/heartbeat")),
    (err: unknown) => err instanceof WorkerAuthError && err.code === "WORKER_AUTH_MISSING"
  );
});

test("incorrect worker key → invalid", () => {
  assert.equal(validateWorkerApiKey("Bearer wrong-key"), false);
  assert.throws(
    () =>
      assertWorkerAuthorized(
        new Request("https://example.com/api/internal/worker/heartbeat", {
          headers: { authorization: "Bearer wrong-key-xxxxxxxxxxxxxxxxxxxx" },
        })
      ),
    (err: unknown) => err instanceof WorkerAuthError && err.code === "WORKER_AUTH_INVALID"
  );
});

test("correct worker key → valid", () => {
  assert.equal(validateWorkerApiKey("Bearer test-worker-key-exactly-32chars!!"), true);
});

if (prev === undefined) delete process.env.WORKER_API_KEY;
else process.env.WORKER_API_KEY = prev;

console.log("worker-auth-negative: all passed");
