import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

async function run(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

async function main() {
  console.log("prune-and-artifacts");

  await run("prune script uses repodiet:deep_scan_jobs SCAN prefix", () => {
    const src = readFileSync("scripts/prune-terminal-deep-scans.ts", "utf8");
    assert.match(src, /repodiet:deep_scan_jobs:/);
    assert.match(src, /\.scan\(/);
    assert.doesNotMatch(src, /redis\.keys\(/);
    assert.match(src, /repodiet:payments:/);
    assert.match(src, /repodiet:execution_receipts:/);
    assert.match(src, /Never deletes|protectedPrefixes|PROTECTED_PREFIXES/);
  });

  await run("persistent store keys use repodiet: collection prefix", () => {
    const src = readFileSync("src/lib/store/persistent-store.ts", "utf8");
    assert.match(src, /repodiet:\$\{collection\}:\$\{id\}/);
  });

  await run("analysis worker stores archive as GitHub Actions artifact reference path", () => {
    const wf = readFileSync(".github/workflows/repodiet-analysis-worker.yml", "utf8");
    assert.match(wf, /upload-artifact/);
    assert.match(wf, /download-artifact|actions\/download-artifact/);
    // Redis must not be the archive blob store in the worker scripts.
    const claim = readFileSync("scripts/actions-worker/claim.ts", "utf8");
    assert.doesNotMatch(claim, /setPersistentRecord\([^\)]*zipBase64/);
    assert.doesNotMatch(claim, /base64.*UPSTASH|UPSTASH.*base64/);
  });

  console.log("prune-and-artifacts: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
