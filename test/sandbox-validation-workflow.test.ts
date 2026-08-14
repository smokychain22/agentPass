import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * PR B — structural pins for .github/workflows/repodiet-sandbox-validation-worker.yml,
 * mirroring the same properties test/github-actions-worker.test.ts pins for the
 * existing analysis worker: three isolated jobs, no secrets in the untrusted
 * middle job, no git/PR write permissions anywhere, dispatch token never
 * referenced as a workflow secret.
 */

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("sandbox-validation-workflow");

const wf = fs.readFileSync(
  path.join(process.cwd(), ".github/workflows/repodiet-sandbox-validation-worker.yml"),
  "utf8"
);

test("triggered by repository_dispatch on repodiet_sandbox_validation only", () => {
  assert.match(wf, /repository_dispatch/);
  assert.match(wf, /repodiet_sandbox_validation/);
  assert.equal(/workflow_dispatch:/.test(wf), false);
});

test("three isolated jobs: claim, validate, complete", () => {
  assert.match(wf, /name:\s*claim/);
  assert.match(wf, /name:\s*validate/);
  assert.match(wf, /name:\s*complete/);
  assert.match(wf, /needs:\s*claim/);
  assert.match(wf, /needs:\s*\[claim,\s*validate\]/);
  assert.match(wf, /if:\s*always\(\)/);
});

test("scoped per-run concurrency prevents two dispatches racing the same sandbox run", () => {
  assert.match(wf, /concurrency:/);
  assert.match(wf, /group:\s*repodiet-sandbox-validation-\$\{\{\s*github\.event\.client_payload\.runId\s*\}\}/);
});

test("top-level permissions are read-only; no job ever grants git or PR write", () => {
  assert.match(wf, /permissions:\s*\n\s*contents:\s*read/);
  assert.equal(wf.includes("contents: write"), false);
  assert.equal(wf.includes("pull-requests: write"), false);
});

test("the dispatch PAT is never referenced as a workflow secret", () => {
  assert.equal(/secrets\.[A-Z0-9_]*DISPATCH/.test(wf), false);
});

test("the untrusted validate job receives neither the worker API key nor the callback secret", () => {
  const validateBlock = wf.split(/\n {2}validate:/)[1]?.split(/\n {2}complete:/)[0] ?? "";
  assert.ok(validateBlock.length > 0, "could not isolate the validate job block");
  assert.equal(validateBlock.includes("REPODIET_WORKER_API_KEY"), false);
  assert.equal(validateBlock.includes("REPODIET_WORKER_CALLBACK_SECRET"), false);
  assert.equal(validateBlock.includes("secrets.REPODIET_WORKER"), false);
});

test("the validate job runs the sandbox-validate script, which performs both git and repository verification", () => {
  // The untrusted job DOES execute the target repository's own npm scripts
  // (via runRepositoryVerification, invoked from sandbox-validate.ts) once
  // git apply --check passes — this is intentional (see the workflow header
  // comment), not a gap. What must never happen is a RepoDiet secret ending
  // up in this job's env, which the sibling test above already pins.
  const validateBlock = wf.split(/\n {2}validate:/)[1]?.split(/\n {2}complete:/)[0] ?? "";
  assert.match(validateBlock, /sandbox-validate\.ts/);
});

console.log("sandbox-validation-workflow: all passed");
