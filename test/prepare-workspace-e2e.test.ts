import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("prepare-workspace-e2e");

async function main() {
  await test("velz-cmd repodiet-e2e-test does not use bundled fixture by default", async () => {
  const prev = process.env.REPODIET_E2E_FIXTURE_PATH;
  const prevUse = process.env.REPODIET_USE_E2E_FIXTURE;
  delete process.env.REPODIET_E2E_FIXTURE_PATH;
  delete process.env.REPODIET_USE_E2E_FIXTURE;

  const source = await fs.readFile(
    path.join(ROOT, "src/lib/scanner/prepare-workspace.ts"),
    "utf8"
  );
  assert.match(source, /shouldUseBundledE2eFixture/);
  assert.doesNotMatch(source, /return \/repodiet-e2e-test\/i\.test\(repoUrl\)/);

  if (prev) process.env.REPODIET_E2E_FIXTURE_PATH = prev;
  });

  await test("fixture opt-in requires REPODIET_E2E_FIXTURE_PATH or REPODIET_USE_E2E_FIXTURE", async () => {
  const { prepareRepoWorkspace } = await import("../src/lib/scanner/prepare-workspace");
  const prev = process.env.REPODIET_E2E_FIXTURE_PATH;
  delete process.env.REPODIET_E2E_FIXTURE_PATH;
  delete process.env.REPODIET_USE_E2E_FIXTURE;

  const ws = await prepareRepoWorkspace("https://github.com/velz-cmd/repodiet-e2e-test", "main");
  try {
    const exactDup = await fs
      .access(path.join(ws.rootDir, "src/lib/exact-dup-copy.ts"))
      .then(() => true)
      .catch(() => false);
    assert.equal(exactDup, false, "live velz-cmd repo must not include bundled fixture-only files");
  } finally {
    await ws.cleanup();
  }

  if (prev) process.env.REPODIET_E2E_FIXTURE_PATH = prev;
  });

  console.log("prepare-workspace-e2e: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
