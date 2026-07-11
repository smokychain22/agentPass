import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import {
  assertBaseCommitFresh,
  buildCanonicalRepositoryPatch,
  buildChangeOperationsFromEdits,
  parseGitApplyError,
  validateCanonicalPatch,
} from "../src/lib/patch-kit/canonical-patch";
import { mergeCleanupPatches } from "../src/lib/patch-kit/merge-patches";
import { buildTextDiff } from "../src/lib/execution/fix-preflight";
import { extractApplyablePatch } from "../src/lib/patch-kit/validate-patch";

async function testConcatenatedPatchesRejected(): Promise<void> {
  const baseline = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-canonical-base-"));
  const rel = "src/panel.tsx";
  const full = path.join(baseline, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const original = 'import { Clock, Zap } from "lucide-react";\nexport function Panel() { return null; }\n';
  await fs.writeFile(full, original, "utf8");
  const afterFirst = original.replace("Clock, ", "");
  const afterSecond = afterFirst.replace("Zap, ", "");

  const broken = mergeCleanupPatches(
    buildTextDiff(rel, original, afterFirst),
    buildTextDiff(rel, afterFirst, afterSecond)
  );

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-canonical-work-"));
  const canonical = await buildCanonicalRepositoryPatch(
    baseline,
    [{ path: rel, content: afterSecond }],
    workDir
  );
  assert.ok(canonical.patch.includes("diff --git"));

  const fresh = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-canonical-apply-"));
  await fs.mkdir(path.join(fresh, "src"), { recursive: true });
  await fs.writeFile(path.join(fresh, rel), original, "utf8");
  await execa("git", ["init"], { cwd: fresh, reject: false });
  await execa("git", ["add", "-A"], { cwd: fresh, reject: false });
  await execa(
    "git",
    ["-c", "user.email=repodiet@local", "-c", "user.name=RepoDiet", "commit", "-m", "baseline"],
    { cwd: fresh, reject: false }
  );

  const brokenFile = path.join(fresh, "broken.patch");
  await fs.writeFile(brokenFile, extractApplyablePatch(broken), "utf8");
  const brokenCheck = await execa("git", ["apply", "--check", "--index", brokenFile], {
    cwd: fresh,
    reject: false,
  });
  assert.notEqual(brokenCheck.exitCode, 0);

  const goodFile = path.join(fresh, "good.patch");
  await fs.writeFile(goodFile, extractApplyablePatch(canonical.patch), "utf8");
  const goodCheck = await execa("git", ["apply", "--check", "--index", goodFile], {
    cwd: fresh,
    reject: false,
  });
  assert.equal(goodCheck.exitCode, 0, goodCheck.stderr);

  await fs.rm(baseline, { recursive: true, force: true });
  await fs.rm(workDir, { recursive: true, force: true });
  await fs.rm(fresh, { recursive: true, force: true });
}

async function testValidationInSeparateWorkspace(): Promise<void> {
  const baseline = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-validate-base-"));
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-validate-work-"));
  const rel = "src/Dashboard.tsx";
  const original = 'import { Clock } from "lucide-react";\nexport function Dashboard() { return null; }\n';
  const updated = 'export function Dashboard() { return null; }\n';
  await fs.mkdir(path.join(baseline, "src"), { recursive: true });
  await fs.writeFile(path.join(baseline, rel), original, "utf8");

  const { patch, operations } = await buildCanonicalRepositoryPatch(
    baseline,
    [{ path: rel, content: updated }],
    workDir
  );

  const result = await validateCanonicalPatch({
    baselineRoot: baseline,
    patch,
    cleanupRunId: "test_run",
    repository: "owner/repo",
    baseCommitSha: "abc123",
    workDir,
    expectedOperations: operations,
  });

  assert.equal(result.status, "passed", result.error);
  assert.ok(result.patchHash);
  assert.equal(result.attempt?.command.join(" "), "git apply --check --index --verbose cleanup.patch");

  await fs.rm(baseline, { recursive: true, force: true });
  await fs.rm(workDir, { recursive: true, force: true });
}

async function testStaleBaseCommitRejected(): Promise<void> {
  const stale = assertBaseCommitFresh("aaa", "bbb");
  assert.equal(stale.stale, true);
  assert.equal(stale.failureCode, "BASE_COMMIT_STALE");
  const fresh = assertBaseCommitFresh("aaa", "aaa");
  assert.equal(fresh.stale, false);
}

async function testParseGitApplyError(): Promise<void> {
  const parsed = parseGitApplyError(
    "error: patch failed: src/components/Dashboard.tsx:1\nerror: src/components/Dashboard.tsx: patch does not apply"
  );
  assert.equal(parsed.failingPath, "src/components/Dashboard.tsx");
  assert.match(parsed.message, /patch failed/);
}

async function testChangeOperationsFromEdits(): Promise<void> {
  const baseline = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-ops-"));
  await fs.mkdir(path.join(baseline, "src"), { recursive: true });
  await fs.writeFile(path.join(baseline, "src/a.ts"), "a\n", "utf8");
  await fs.writeFile(path.join(baseline, "src/remove.ts"), "remove\n", "utf8");
  const ops = await buildChangeOperationsFromEdits(baseline, [
    { path: "src/a.ts", content: "b\n" },
    { path: "src/remove.ts", content: "" },
  ]);
  assert.equal(ops.length, 2);
  assert.equal(ops[0].type, "edit");
  assert.equal(ops[1].type, "delete");
  await fs.rm(baseline, { recursive: true, force: true });
}

Promise.all([
  testConcatenatedPatchesRejected(),
  testValidationInSeparateWorkspace(),
  testStaleBaseCommitRejected(),
  testParseGitApplyError(),
  testChangeOperationsFromEdits(),
]).then(() => {
  console.log("canonical-patch.test.ts: ok");
});
