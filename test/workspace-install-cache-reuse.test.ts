import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveVerificationCacheDir, describeProcessTermination } from "../src/lib/execution/workspace-install";
import { prepareNpmCacheDir, prepareCleanInstallWorkspace } from "../src/lib/execution/verification-workspace";

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

async function scratchDir(label: string): Promise<string> {
  const dir = path.join(os.tmpdir(), "repodiet-test-cache-reuse", `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Incident #35 follow-up: baseline and patched verification used to get
 * separate npm caches unconditionally, so an unmodified dependency tree
 * (the common case) paid for two full cold network installs instead of one.
 * These tests cover the fix: shared cache when the lockfile is unpatched,
 * isolated cache when it is, and that reuse never touches node_modules or
 * package.json directly (only npm's own download cache is shared).
 */
async function main() {
  console.log("workspace-install-cache-reuse");

  const RUN_ID = "cache-reuse-test-run";

  await test("baseline and patched resolve to the SAME cache dir when the lockfile is unpatched", () => {
    const baselineCache = resolveVerificationCacheDir(RUN_ID, "/tmp/whatever/baseline", "baseline", false);
    const patchedCache = resolveVerificationCacheDir(RUN_ID, "/tmp/whatever/patched", "patched", false);
    assert.equal(baselineCache, patchedCache);
  });

  await test("baseline and patched resolve to DIFFERENT cache dirs when the lockfile IS patched", () => {
    const baselineCache = resolveVerificationCacheDir(RUN_ID, "/tmp/whatever/baseline", "baseline", true);
    const patchedCache = resolveVerificationCacheDir(RUN_ID, "/tmp/whatever/patched", "patched", true);
    assert.notEqual(baselineCache, patchedCache);
  });

  await test("cache dir resolution is stable and deterministic for the same inputs", () => {
    const a = resolveVerificationCacheDir(RUN_ID, "/tmp/whatever/baseline", "baseline", false);
    const b = resolveVerificationCacheDir(RUN_ID, "/tmp/whatever/baseline", "baseline", false);
    assert.equal(a, b);
  });

  await test("different cleanupRunIds never collide, even for the shared-cache case", () => {
    const a = resolveVerificationCacheDir("run-a", "/tmp/whatever/baseline", "baseline", false);
    const b = resolveVerificationCacheDir("run-b", "/tmp/whatever/baseline", "baseline", false);
    assert.notEqual(a, b);
  });

  await test("repositories without a lockfile (lockfilePatched defaults false) still get the shared-cache speed benefit", () => {
    const baselineCache = resolveVerificationCacheDir(RUN_ID, "/tmp/x/baseline", "baseline");
    const patchedCache = resolveVerificationCacheDir(RUN_ID, "/tmp/x/patched", "patched");
    assert.equal(baselineCache, patchedCache);
  });

  await test("prepareNpmCacheDir with wipe:false preserves an existing baseline-populated cache", async () => {
    const dir = await scratchDir("preserve");
    await prepareNpmCacheDir(dir);
    const marker = path.join(dir, "some-package.tgz.cache");
    await fs.writeFile(marker, "baseline-downloaded-package");

    await prepareNpmCacheDir(dir, { wipe: false });

    const content = await fs.readFile(marker, "utf8");
    assert.equal(content, "baseline-downloaded-package");
    await fs.rm(dir, { recursive: true, force: true });
  });

  await test("prepareNpmCacheDir's default behavior (no options) still wipes, unchanged from before this fix", async () => {
    const dir = await scratchDir("wipe-default");
    await prepareNpmCacheDir(dir);
    const marker = path.join(dir, "stale.cache");
    await fs.writeFile(marker, "stale-data");

    await prepareNpmCacheDir(dir);

    const exists = await fs
      .access(marker)
      .then(() => true)
      .catch(() => false);
    assert.equal(exists, false);
    await fs.rm(dir, { recursive: true, force: true });
  });

  await test("a reused cache dir remains a real, usable directory (reuse cannot leave installs cache-less)", async () => {
    const dir = await scratchDir("usable");
    await prepareNpmCacheDir(dir);
    await fs.writeFile(path.join(dir, "left-pad.tgz.cache"), "cached-tarball");

    await prepareNpmCacheDir(dir, { wipe: false });

    const stat = await fs.stat(dir);
    assert.equal(stat.isDirectory(), true);
    const files = await fs.readdir(dir);
    assert.ok(files.includes("left-pad.tgz.cache"), "reused cache must still contain what baseline downloaded");
    await fs.rm(dir, { recursive: true, force: true });
  });

  await test("prepareCleanInstallWorkspace wipes only its own root's node_modules, never a sibling's", async () => {
    const parent = await scratchDir("workspace");
    const baselineRoot = path.join(parent, "baseline");
    const patchedRoot = path.join(parent, "patched");
    await fs.mkdir(path.join(baselineRoot, "node_modules"), { recursive: true });
    await fs.mkdir(path.join(patchedRoot, "node_modules"), { recursive: true });
    await fs.writeFile(path.join(baselineRoot, "node_modules", "marker.txt"), "baseline-modules");
    await fs.writeFile(path.join(patchedRoot, "node_modules", "marker.txt"), "patched-modules");

    // Simulates patched verification cleaning its own workspace before install.
    await prepareCleanInstallWorkspace(patchedRoot);

    const baselineStillThere = await fs.readFile(path.join(baselineRoot, "node_modules", "marker.txt"), "utf8");
    const patchedGone = await fs
      .access(path.join(patchedRoot, "node_modules"))
      .then(() => true)
      .catch(() => false);

    assert.equal(baselineStillThere, "baseline-modules");
    assert.equal(patchedGone, false);
    await fs.rm(parent, { recursive: true, force: true });
  });

  await test("resolving and preparing the cache dir never touches the workspace's package.json", async () => {
    const dir = await scratchDir("manifest");
    const pkgPath = path.join(dir, "package.json");
    const original = JSON.stringify({ name: "fixture", version: "1.0.0" });
    await fs.writeFile(pkgPath, original);

    const cacheDir = resolveVerificationCacheDir(RUN_ID, dir, "patched", false);
    await prepareNpmCacheDir(cacheDir, { wipe: false });

    const after = await fs.readFile(pkgPath, "utf8");
    assert.equal(after, original);
    await fs.rm(dir, { recursive: true, force: true });
  });

  await test("PR #184's termination diagnostics are unaffected by the cache-reuse change", () => {
    assert.match(describeProcessTermination({ timedOut: true }) ?? "", /exceeded its time limit/i);
    assert.match(describeProcessTermination({ exitCode: 137 }) ?? "", /out of memory/i);
  });

  console.log("workspace-install-cache-reuse: all tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
