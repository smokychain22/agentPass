import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildVerificationInstallCommands,
  FORBIDDEN_VERIFICATION_INSTALL_FLAGS,
  readNpmRcPolicy,
} from "../src/lib/execution/package-manager-adapter";
import { isFrameworkProtectedDependency } from "../src/lib/findings/framework-protected";

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

async function run() {
  console.log("verification-pipeline tests");

  await test("Next.js protects react-dom and @types/react-dom", () => {
    assert.equal(isFrameworkProtectedDependency("react-dom", "next"), true);
    assert.equal(isFrameworkProtectedDependency("@types/react-dom", "next"), true);
    assert.equal(isFrameworkProtectedDependency("left-pad", "next"), false);
  });

  await test("verification npm commands include optional deps and exclude forbidden flags", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-pm-"));
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "fixture", dependencies: { next: "15.0.0" } }, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(root, "package-lock.json"),
      JSON.stringify({ name: "fixture", lockfileVersion: 3, packages: { "": { name: "fixture" } } }, null, 2),
      "utf8"
    );

    const plans = await buildVerificationInstallCommands(root, "npm", path.join(root, ".cache"));
    assert.ok(plans.length > 0);
    for (const plan of plans) {
      assert.ok(plan.command.includes("--include=optional"));
      for (const flag of FORBIDDEN_VERIFICATION_INSTALL_FLAGS) {
        assert.equal(plan.command.includes(flag), false, `forbidden flag ${flag}`);
      }
    }
    await fs.rm(root, { recursive: true, force: true });
  });

  await test("legacy-peer-deps only when committed in .npmrc", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-npmrc-"));
    await fs.writeFile(path.join(root, ".npmrc"), "legacy-peer-deps=true\n", "utf8");
    const policy = await readNpmRcPolicy(root);
    assert.equal(policy.legacyPeerDeps, true);
    assert.equal(policy.source, "committed-npmrc");
    await fs.rm(root, { recursive: true, force: true });
  });

  console.log("verification-pipeline: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
