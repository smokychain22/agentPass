import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { generateGitPatch, validateGitPatch } from "../src/lib/execution/git-clone";

/**
 * Regression for a production defect caught live on 2026-08-14
 * (sandbox_run_8DlMhbrN7zPE, workflow run 31800768348): the untrusted
 * GitHub Actions validate job called `generateGitPatch(baselineRoot, edits)`
 * directly on the same directory `validateGitPatch` later clones from.
 * `generateGitPatch` mutates its rootDir in place (deletes/edits files and
 * stages them) — so by the time `validateGitPatch` copied that directory,
 * the delete targets were already gone, and every `git apply --check`
 * failed with "does not exist in index" even though the patch was correct.
 *
 * The fix (matching executeRepositoryCleanupLocal's existing
 * baseline/transformed split in repository-executor.ts): generate the patch
 * against a throwaway COPY, and only ever hand validateGitPatch the
 * untouched original. This pins that shape with real git commands against
 * real temp directories — no mocks — so a future refactor can't reintroduce
 * the same mutation-order bug silently.
 */

function test(name: string, fn: () => Promise<void>) {
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

async function initBaselineGitRepo(root: string): Promise<void> {
  await execa("git", ["init", "-q"], { cwd: root });
  await execa("git", ["config", "user.email", "test@repodiet.local"], { cwd: root });
  await execa("git", ["config", "user.name", "RepoDiet Test"], { cwd: root });
  await execa("git", ["add", "-A"], { cwd: root });
  await execa("git", ["commit", "-q", "-m", "baseline", "--allow-empty"], { cwd: root });
}

async function buildFixtureBaseline(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-sandbox-validate-flow-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "keep.ts"), "export const keep = 1;\n", "utf8");
  await fs.writeFile(path.join(root, "src", "delete-me.ts"), "export const gone = 1;\n", "utf8");
  await fs.writeFile(path.join(root, "src", "edit-me.ts"), "export const before = 1;\n", "utf8");
  await initBaselineGitRepo(root);
  return root;
}

console.log("sandbox-validate git flow (baseline/transformed split)");

async function main() {
  await test("a delete operation validates correctly when the patch is generated against a copy, not baselineRoot itself", async () => {
    const baselineRoot = await buildFixtureBaseline();
    const unpackRoot = path.dirname(baselineRoot);
    const transformedRoot = path.join(unpackRoot, "transformed");
    await fs.cp(baselineRoot, transformedRoot, { recursive: true, force: true });

    const edits = [{ path: "src/delete-me.ts", content: "" }];
    const { patch } = await generateGitPatch(transformedRoot, edits);
    assert.match(patch, /diff --git/);

    // baselineRoot must be untouched by generateGitPatch's mutation of the copy.
    const stillThere = await fs
      .access(path.join(baselineRoot, "src", "delete-me.ts"))
      .then(() => true)
      .catch(() => false);
    assert.ok(stillThere, "baselineRoot must not be mutated by generateGitPatch on the copy");

    const validated = await validateGitPatch(baselineRoot, patch, ["src/delete-me.ts"]);
    assert.equal(validated.status, "passed", `expected passed, got ${validated.status}: ${validated.stderr}`);
    assert.deepEqual(validated.validatedPaths, ["src/delete-me.ts"]);
  });

  await test("reproduces the actual production bug: generating the patch directly on baselineRoot breaks validation", async () => {
    const baselineRoot = await buildFixtureBaseline();

    // This is the exact defect: mutate baselineRoot itself, then validate against it.
    const edits = [{ path: "src/delete-me.ts", content: "" }];
    const { patch } = await generateGitPatch(baselineRoot, edits);

    const validated = await validateGitPatch(baselineRoot, patch, ["src/delete-me.ts"]);
    assert.equal(
      validated.status,
      "failed",
      "this pins the historical bug's actual failure mode — if this ever starts passing, validateGitPatch's cloning behavior changed and this test (and its sibling above) should be revisited"
    );
    assert.match(validated.stderr, /does not exist in index/);
  });

  await test("an edit (not a delete) also validates correctly against the untouched baseline", async () => {
    const baselineRoot = await buildFixtureBaseline();
    const unpackRoot = path.dirname(baselineRoot);
    const transformedRoot = path.join(unpackRoot, "transformed-edit");
    await fs.cp(baselineRoot, transformedRoot, { recursive: true, force: true });

    const edits = [{ path: "src/edit-me.ts", content: "export const before = 2;\n" }];
    const { patch } = await generateGitPatch(transformedRoot, edits);
    const validated = await validateGitPatch(baselineRoot, patch, ["src/edit-me.ts"]);
    assert.equal(validated.status, "passed", `expected passed, got ${validated.status}: ${validated.stderr}`);
  });

  console.log("sandbox-validate git flow: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
