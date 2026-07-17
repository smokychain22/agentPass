import assert from "node:assert/strict";
import {
  classifyUntrustedSandbox,
  packageScriptsAllowed,
  SandboxIncompleteError,
} from "../src/lib/sandbox/untrusted-runner";

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    await fn();
    console.log(`  ✓ ${name}`);
  })();
}

async function run() {
  console.log("worker-readonly-safety");

  await test("package scripts fail closed when sandbox is off", () => {
    const prev = process.env.REPODIET_UNTRUSTED_SANDBOX;
    const prevDocker = process.env.REPODIET_DOCKER_SANDBOX;
    process.env.REPODIET_UNTRUSTED_SANDBOX = "off";
    delete process.env.REPODIET_DOCKER_SANDBOX;
    assert.equal(classifyUntrustedSandbox(), "SANDBOX_INCOMPLETE");
    assert.equal(packageScriptsAllowed(), false);
    if (prev === undefined) delete process.env.REPODIET_UNTRUSTED_SANDBOX;
    else process.env.REPODIET_UNTRUSTED_SANDBOX = prev;
    if (prevDocker === undefined) delete process.env.REPODIET_DOCKER_SANDBOX;
    else process.env.REPODIET_DOCKER_SANDBOX = prevDocker;
  });

  await test("setting docker without DOCKER_SANDBOX flag remains incomplete", () => {
    const prev = process.env.REPODIET_UNTRUSTED_SANDBOX;
    const prevDocker = process.env.REPODIET_DOCKER_SANDBOX;
    process.env.REPODIET_UNTRUSTED_SANDBOX = "docker";
    delete process.env.REPODIET_DOCKER_SANDBOX;
    assert.equal(classifyUntrustedSandbox(), "SANDBOX_INCOMPLETE");
    assert.equal(packageScriptsAllowed(), false);
    if (prev === undefined) delete process.env.REPODIET_UNTRUSTED_SANDBOX;
    else process.env.REPODIET_UNTRUSTED_SANDBOX = prev;
    if (prevDocker === undefined) delete process.env.REPODIET_DOCKER_SANDBOX;
    else process.env.REPODIET_DOCKER_SANDBOX = prevDocker;
  });

  await test("SandboxIncompleteError is fail-closed", () => {
    const err = new SandboxIncompleteError();
    assert.equal(err.code, "SANDBOX_INCOMPLETE");
  });

  await test("read-only findings analyze route forces readOnly true", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/app/api/findings/analyze/route.ts", "utf8");
    assert.match(source, /readOnly:\s*true/);
  });

  await test("execute baseline labels forbid false verification in read-only", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/lib/deep-scan/execute.ts", "utf8");
    assert.match(source, /NOT_RUN/);
    assert.match(source, /SANDBOX_REQUIRED/);
    assert.match(source, /READ_ONLY_FINDINGS/);
    assert.equal(/npm install/.test(source) && /await execa\([^)]*npm[^)]*install/.test(source), false);
  });

  console.log("worker-readonly-safety: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
