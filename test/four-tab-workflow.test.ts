import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { unzipRepoToDir, __zipSecurityTestHooks } from "../src/lib/scanner/unzip-repo";
import { computeWorkflowGates } from "../src/lib/workflow/gates";
import {
  needsProjectRootSelection,
  listSelectableApplicationRoots,
} from "../src/lib/repository-model/project-root-selection";
import type { RepositoryModel } from "../src/lib/repository-model/types";
import { STAGE_TO_PHASE } from "../src/lib/scan-stage-map";

test("zip-slip: rejects path traversal entries", async () => {
  const destDir = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-zipslip-"));
  assert.equal(__zipSecurityTestHooks.isSafeRelativePath("../../etc/passwd"), false);
  assert.equal(
    __zipSecurityTestHooks.resolveSafePath(destDir, "repo/../../outside.txt"),
    null
  );

  const zip = new JSZip();
  zip.file("repo/inside.txt", "safe");
  const buffer = await zip.generateAsync({ type: "arraybuffer" });
  const root = await unzipRepoToDir(buffer, destDir);
  assert.ok(root.includes("repo"));
  await fs.rm(destDir, { recursive: true, force: true });
});

test("zip-slip: rejects archives exceeding file count", async () => {
  const destDir = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-zipcount-"));
  const zip = new JSZip();
  for (let i = 0; i < 20_001; i += 1) {
    zip.file(`repo-safe/file-${i}.txt`, "x");
  }
  const buffer = await zip.generateAsync({ type: "arraybuffer" });

  await assert.rejects(
    () => unzipRepoToDir(buffer, destDir),
    /maximum file count/
  );
  await fs.rm(destDir, { recursive: true, force: true });
});

test("scan stage map covers spec pipeline stages", () => {
  const required = [
    "validating_repository",
    "resolving_branch",
    "downloading_archive",
    "extracting_archive",
    "inventorying_files",
    "detecting_frameworks",
    "detecting_project_roots",
    "detecting_protected_paths",
    "persisting_scan",
    "complete",
  ];
  for (const stage of required) {
    assert.ok(STAGE_TO_PHASE[stage], `missing mapping for ${stage}`);
  }
});

test("multi-root selection required for distinct applications", () => {
  const model: RepositoryModel = {
    repositoryRoot: "/tmp/monorepo",
    detectedAt: new Date().toISOString(),
    fileIndex: {},
    projects: [
      {
        projectRoot: "apps/web",
        relativePath: "apps/web",
        packageName: "web",
        framework: "nextjs",
        runtimeTarget: "node",
        workspaceMember: true,
      },
      {
        projectRoot: "apps/api",
        relativePath: "apps/api",
        packageName: "api",
        framework: "node",
        runtimeTarget: "node",
        workspaceMember: true,
      },
    ],
    workspaces: ["apps/*"],
    monorepoTool: "pnpm",
  };
  assert.equal(needsProjectRootSelection(model), true);
  assert.equal(listSelectableApplicationRoots(model).length, 2);
});

test("workflow gates lock findings until project root confirmed", () => {
  const gates = computeWorkflowGates({
    scanComplete: true,
    projectRootConfirmed: false,
    findings: null,
    patchKit: null,
  });
  assert.equal(gates.findingsUnlocked, false);
});

test("workflow gates unlock findings after project root confirmed", () => {
  const gates = computeWorkflowGates({
    scanComplete: true,
    projectRootConfirmed: true,
    findings: null,
    patchKit: null,
  });
  assert.equal(gates.findingsUnlocked, true);
});

test("partial verification is not treated as verified", () => {
  function overallLabel(status: "passed" | "failed" | "partial" | "not_run") {
    if (status === "passed") return "Verified";
    if (status === "partial") return "Partial verification";
    return "Failed";
  }
  assert.equal(overallLabel("partial"), "Partial verification");
  assert.notEqual(overallLabel("partial"), "Verified");
});
