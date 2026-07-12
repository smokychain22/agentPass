import assert from "node:assert/strict";
import { computeScanCoverage } from "../src/lib/scanner/intelligence-manifest";
import type { RepositoryModel } from "../src/lib/repository-model/types";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("intelligence-manifest");

const baseModel: RepositoryModel = {
  repositoryRoot: "/tmp",
  projects: [],
  workspaces: [],
  detectedAt: new Date().toISOString(),
  fileIndex: {
    "src/app/page.tsx": {
      repositoryPath: "src/app/page.tsx",
      projectRoot: ".",
      packageName: "app",
      framework: "nextjs",
      runtimeTarget: "mixed",
      entrypointRole: "app_router_page",
      protectedRoles: ["route_component"],
    },
    "src/lib/util.ts": {
      repositoryPath: "src/lib/util.ts",
      projectRoot: ".",
      packageName: "app",
      framework: "nextjs",
      runtimeTarget: "browser",
      entrypointRole: "library",
      protectedRoles: [],
    },
  },
};

test("complete coverage when commit pinned and files classified", () => {
  const coverage = computeScanCoverage({
    tree: {
      summary: { totalFiles: 10, totalFolders: 2, totalSizeKb: 100, topExtensions: { ".ts": 5 } },
      topLevelFolders: ["src"],
      allRelativePaths: ["src/app/page.tsx", "src/lib/util.ts", "readme.md"],
      largestFiles: [],
    },
    repositoryModel: baseModel,
    analyzableSourceFiles: 2,
    protectedFileCount: 0,
    commitSha: "abc123",
    warnings: [],
  });
  assert.equal(coverage.status, "complete_with_exclusions");
  assert.equal(coverage.entryPointsDetected, 1);
  assert.equal(coverage.readinessForFindings, true);
});

test("partial coverage when commit missing", () => {
  const coverage = computeScanCoverage({
    tree: {
      summary: { totalFiles: 5, totalFolders: 1, totalSizeKb: 50, topExtensions: {} },
      topLevelFolders: ["src"],
      allRelativePaths: ["src/a.ts", "src/b.ts"],
      largestFiles: [],
    },
    repositoryModel: baseModel,
    analyzableSourceFiles: 2,
    protectedFileCount: 0,
    warnings: [],
  });
  assert.equal(coverage.status, "partial");
  assert.equal(coverage.readinessForFindings, false);
  assert.ok(coverage.warnings.some((w) => w.includes("Commit SHA")));
});

test("failed coverage when no analyzable files", () => {
  const coverage = computeScanCoverage({
    tree: {
      summary: { totalFiles: 1, totalFolders: 0, totalSizeKb: 1, topExtensions: {} },
      topLevelFolders: [],
      allRelativePaths: ["readme.md"],
      largestFiles: [],
    },
    repositoryModel: { ...baseModel, fileIndex: {} },
    analyzableSourceFiles: 0,
    protectedFileCount: 0,
    commitSha: "abc",
    warnings: [],
  });
  assert.equal(coverage.status, "failed");
  assert.equal(coverage.readinessForFindings, false);
});

console.log("intelligence-manifest: all passed");
