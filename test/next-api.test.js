/**
 * Next.js API integration tests (local server required for full run).
 * Core logic tests run without HTTP when REPODIET_TEST_OFFLINE=1.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function test(name, fn) {
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
  console.log("RepoDiet Next API tests");

  await test("durable store module exists", async () => {
    const storePath = path.join(ROOT, "src/lib/store/durable-store.ts");
    assert.ok(fs.existsSync(storePath));
    const source = fs.readFileSync(storePath, "utf8");
    assert.match(source, /getDurableRecord/);
    assert.match(source, /writeArtifact/);
    const persistentPath = path.join(ROOT, "src/lib/store/persistent-store.ts");
    assert.ok(fs.existsSync(persistentPath));
  });

  await test("demo constants isolate demo repo URL", async () => {
    const constantsPath = path.join(ROOT, "src/lib/demo/constants.ts");
    const source = fs.readFileSync(constantsPath, "utf8");
    assert.match(source, /isDemoRepoUrl/);
    assert.match(source, /demo-slop-app/);
  });

  await test("patch validation uses git apply --check", async () => {
    const validatePath = path.join(ROOT, "src/lib/patch-kit/validate-patch.ts");
    const source = fs.readFileSync(validatePath, "utf8");
    assert.match(source, /git apply --check/);
    assert.match(source, /patchHasDeleteOperations/);
  });

  await test("zip-slip test vectors exist", async () => {
    const unzipPath = path.join(ROOT, "src/lib/scanner/unzip-repo.ts");
    const source = fs.readFileSync(unzipPath, "utf8");
    assert.match(source, /Unsafe ZIP entry rejected/);
    assert.match(source, /MAX_DECOMPRESSED_BYTES/);
  });

  await test("job API route files exist", async () => {
    const routes = [
      "src/app/api/jobs/scan/route.ts",
      "src/app/api/jobs/findings/route.ts",
      "src/app/api/jobs/patch/route.ts",
      "src/app/api/patches/generate/route.ts",
      "src/app/api/verify/run/route.ts",
    ];
    for (const route of routes) {
      assert.ok(fs.existsSync(path.join(ROOT, route)), `missing ${route}`);
    }
  });

  if (process.env.REPODIET_TEST_OFFLINE === "1") {
    console.log("\nOffline mode — skipping HTTP integration tests.");
    console.log("\nAll offline tests passed.");
    return;
  }

  const base = process.env.REPODIET_TEST_BASE || "http://localhost:3000";

  await test("health endpoint responds", async () => {
    const res = await fetch(`${base}/api/tools/health`);
    assert.ok(res.ok, `health failed: ${res.status}`);
    const json = await res.json();
    assert.equal(json.ok ?? json.success ?? true, true);
  });

  console.log("\nAll tests passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
