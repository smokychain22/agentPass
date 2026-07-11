import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

async function generateDeletePatch(rootDir, relPath) {
  await execa("git", ["init"], { cwd: rootDir, reject: false });
  await execa("git", ["add", "-A"], { cwd: rootDir, reject: false });
  await execa(
    "git",
    ["-c", "user.email=repodiet@local", "-c", "user.name=RepoDiet", "commit", "-m", "baseline", "--allow-empty"],
    { cwd: rootDir, reject: false }
  );
  await fs.rm(path.join(rootDir, relPath), { force: true });
  const diff = await execa("git", ["diff", "--no-color", "HEAD", "--", relPath], {
    cwd: rootDir,
    reject: false,
  });
  return diff.stdout ?? "";
}

function extractApplyablePatch(patch) {
  const lines = patch.split("\n");
  const start = lines.findIndex((line) => line.startsWith("diff --git "));
  return start === -1 ? patch : lines.slice(start).join("\n");
}

async function main() {
  console.log("Unified diff patch tests");

  await test("git diff delete patch passes git apply --check", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-patch-"));
    const rel = "src/unused-demo.ts";
    const full = path.join(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, "export const unused = 1;\n", "utf8");

    await execa("git", ["init"], { cwd: root, reject: false });
    await execa("git", ["add", "-A"], { cwd: root, reject: false });
    await execa(
      "git",
      ["-c", "user.email=repodiet@local", "-c", "user.name=RepoDiet", "commit", "-m", "baseline"],
      { cwd: root, reject: false }
    );
    await fs.rm(full, { force: true });

    const diff = await execa("git", ["diff", "--no-color", "HEAD", "--", rel], {
      cwd: root,
      reject: false,
    });
    const patch = diff.stdout ?? "";
    assert.ok(patch.includes("diff --git"), `expected diff, got: ${patch.slice(0, 200)}`);

    const fresh = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-patch-apply-"));
    await fs.mkdir(path.dirname(path.join(fresh, rel)), { recursive: true });
    await fs.writeFile(path.join(fresh, rel), "export const unused = 1;\n", "utf8");
    await execa("git", ["init"], { cwd: fresh, reject: false });
    await execa("git", ["add", "-A"], { cwd: fresh, reject: false });
    await execa(
      "git",
      ["-c", "user.email=repodiet@local", "-c", "user.name=RepoDiet", "commit", "-m", "baseline"],
      { cwd: fresh, reject: false }
    );

    const patchFile = path.join(fresh, "cleanup.patch");
    await fs.writeFile(patchFile, patch.endsWith("\n") ? patch : `${patch}\n`, "utf8");
    const check = await execa("git", ["apply", "--check", patchFile], {
      cwd: fresh,
      reject: false,
    });
    assert.equal(check.exitCode, 0, check.stderr || check.stdout || patch);

    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(fresh, { recursive: true, force: true });
  });

  await test("generate-unified-diff module exists", async () => {
    const source = await fs.readFile(
      path.join(process.cwd(), "src/lib/patch-kit/generate-unified-diff.ts"),
      "utf8"
    );
    assert.match(source, /generateUnifiedDeletePatch/);
    assert.match(source, /\["diff", "--no-color", "HEAD"/);
  });

  console.log("\nAll unified diff tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
