import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import {
  buildConsolidatedPatchFromEdits,
  buildPatchFromWorkspaceDelta,
  collectEditsBetweenWorkspaces,
  dedupeConsolidatedEdits,
  filterEditsAgainstBaseline,
  mergeCleanupPatches,
} from "../src/lib/patch-kit/merge-patches";
import { extractApplyablePatch, patchHasApplyableOperations } from "../src/lib/patch-kit/validate-patch";
import { buildTextDiff } from "../src/lib/execution/fix-preflight";

async function testTwoEditsSameFileConsolidatedPassesApply(): Promise<void> {
  const baseline = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-base-"));
  const rel = "src/panel.tsx";
  const full = path.join(baseline, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const original = [
    'import { Clock, CheckCircle, Zap } from "lucide-react";',
    'import { useState } from "react";',
    "",
    "export function Panel() { return null; }",
    "",
  ].join("\n");
  await fs.writeFile(full, original, "utf8");

  const afterFirst = original.replace("Clock, ", "");
  const afterSecond = afterFirst.replace("Zap, ", "");

  const edits = dedupeConsolidatedEdits([
    { path: rel, content: afterFirst },
    { path: rel, content: afterSecond },
  ]);
  assert.equal(edits.length, 1);

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-work-"));
  const { patch } = await buildConsolidatedPatchFromEdits(baseline, edits, workDir);
  assert.ok(patch.includes("diff --git"), "expected consolidated diff");

  const broken = mergeCleanupPatches(
    buildTextDiff(rel, original, afterFirst),
    buildTextDiff(rel, afterFirst, afterSecond)
  );

  const fresh = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-apply-"));
  await fs.mkdir(path.dirname(path.join(fresh, rel)), { recursive: true });
  await fs.writeFile(path.join(fresh, rel), original, "utf8");
  await execa("git", ["init"], { cwd: fresh, reject: false });
  await execa("git", ["add", "-A"], { cwd: fresh, reject: false });
  await execa(
    "git",
    ["-c", "user.email=repodiet@local", "-c", "user.name=RepoDiet", "commit", "-m", "baseline"],
    { cwd: fresh, reject: false }
  );

  const consolidatedFile = path.join(fresh, "consolidated.patch");
  await fs.writeFile(consolidatedFile, extractApplyablePatch(patch), "utf8");
  const consolidatedCheck = await execa("git", ["apply", "--check", consolidatedFile], {
    cwd: fresh,
    reject: false,
  });
  assert.equal(
    consolidatedCheck.exitCode,
    0,
    `consolidated patch should apply: ${consolidatedCheck.stderr}`
  );

  const brokenFile = path.join(fresh, "broken.patch");
  await fs.writeFile(brokenFile, extractApplyablePatch(broken), "utf8");
  const brokenCheck = await execa("git", ["apply", "--check", brokenFile], {
    cwd: fresh,
    reject: false,
  });
  assert.notEqual(brokenCheck.exitCode, 0, "concatenated per-fix diffs should fail on same file");

  await fs.rm(baseline, { recursive: true, force: true });
  await fs.rm(workDir, { recursive: true, force: true });
  await fs.rm(fresh, { recursive: true, force: true });
}

async function testWorkspaceDeltaCollectsFinalState(): Promise<void> {
  const baseline = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-base-"));
  const modified = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-mod-"));
  const rel = "src/panel.tsx";
  const original = [
    'import { Clock, Zap } from "lucide-react";',
    "export function Panel() { return null; }",
    "",
  ].join("\n");
  const finalContent = 'export function Panel() { return null; }\n';

  for (const root of [baseline, modified]) {
    const full = path.join(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, root === baseline ? original : finalContent, "utf8");
  }

  const edits = await collectEditsBetweenWorkspaces(baseline, modified);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].content, finalContent);

  await fs.rm(baseline, { recursive: true, force: true });
  await fs.rm(modified, { recursive: true, force: true });
}

async function testWorkspaceDeltaPatchIsApplyable(): Promise<void> {
  const baseline = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-ws-base-"));
  const modified = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-ws-mod-"));
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-ws-work-"));
  const rel = "src/Dashboard.tsx";
  const original = 'import { Clock } from "lucide-react";\nexport function Dashboard() { return null; }\n';
  const updated = 'export function Dashboard() { return null; }\n';

  for (const [root, content] of [
    [baseline, original],
    [modified, updated],
  ] as const) {
    const full = path.join(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
  }

  const { patch, edits } = await buildPatchFromWorkspaceDelta(baseline, modified, workDir);
  assert.equal(edits.length, 1);
  assert.ok(patchHasApplyableOperations(patch), `expected applyable patch, got: ${patch.slice(0, 200)}`);

  await fs.rm(baseline, { recursive: true, force: true });
  await fs.rm(modified, { recursive: true, force: true });
  await fs.rm(workDir, { recursive: true, force: true });
}

async function testFilterEditsAgainstBaselineDropsNoops(): Promise<void> {
  const baseline = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-filter-"));
  await fs.writeFile(path.join(baseline, "package.json"), '{"name":"demo"}\n', "utf8");
  const filtered = await filterEditsAgainstBaseline(baseline, [
    { path: "package.json", content: '{"name":"demo"}\n' },
    { path: "src/missing.ts", content: "" },
  ]);
  assert.equal(filtered.length, 0);
  await fs.rm(baseline, { recursive: true, force: true });
}

Promise.all([
  testTwoEditsSameFileConsolidatedPassesApply(),
  testWorkspaceDeltaCollectsFinalState(),
  testWorkspaceDeltaPatchIsApplyable(),
  testFilterEditsAgainstBaselineDropsNoops(),
]).then(() => {
  console.log("consolidated-patch.test.ts: ok");
});
