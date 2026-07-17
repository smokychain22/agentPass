import assert from "node:assert/strict";
import { computeScanCoverage } from "../src/lib/scanner/intelligence-manifest";
import { buildCoverageContract, classifyInventoryPath } from "../src/lib/scanner/inventory";
import type { RepositoryModel } from "../src/lib/repository-model/types";
import type { FullRepositoryInventory } from "../src/lib/scanner/inventory";

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

function inventoryFromPaths(paths: string[]): FullRepositoryInventory {
  const files = paths.map((p) => classifyInventoryPath(p, 100));
  return {
    files,
    allRelativePaths: paths,
    topLevelFolders: ["src"],
    skippedDirectories: [],
    totalBytes: paths.length * 100,
  };
}

test("complete coverage when commit pinned and files classified", () => {
  const paths = ["src/app/page.tsx", "src/lib/util.ts", "readme.md"];
  const inventory = inventoryFromPaths(paths);
  const coverage = computeScanCoverage({
    tree: {
      summary: { totalFiles: 3, totalFolders: 1, totalSizeKb: 1, topExtensions: { ".ts": 1 } },
      topLevelFolders: ["src"],
      allRelativePaths: paths,
      largestFiles: [],
      inventory,
    },
    repositoryModel: baseModel,
    analyzableSourceFiles: 2,
    protectedFileCount: 0,
    commitSha: "abc123",
    warnings: [],
    analyzedSourceFiles: 2,
    analysisComplete: true,
  });
  assert.equal(coverage.coverageStatus, "COMPLETE_FOR_SUPPORTED_SCOPE");
  assert.equal(coverage.entryPointsDetected, 1);
  assert.equal(coverage.readinessForFindings, true);
  assert.equal(coverage.contract.claimsSemanticAnalysisOfAllFiles, false);
  assert.equal(coverage.contract.supportedSourceFiles, 2);
});

test("partial coverage when commit missing", () => {
  const paths = ["src/a.ts", "src/b.ts"];
  const inventory = inventoryFromPaths(paths);
  const coverage = computeScanCoverage({
    tree: {
      summary: { totalFiles: 2, totalFolders: 1, totalSizeKb: 1, topExtensions: {} },
      topLevelFolders: ["src"],
      allRelativePaths: paths,
      largestFiles: [],
      inventory,
    },
    repositoryModel: baseModel,
    analyzableSourceFiles: 2,
    protectedFileCount: 0,
    warnings: [],
    analyzedSourceFiles: 2,
    analysisComplete: false,
  });
  assert.equal(coverage.coverageStatus, "PARTIAL");
  assert.equal(coverage.readinessForFindings, false);
  assert.ok(coverage.warnings.some((w) => w.includes("Commit SHA")));
});

test("failed coverage when no analyzable files", () => {
  const paths = ["readme.md"];
  const inventory = inventoryFromPaths(paths);
  const coverage = computeScanCoverage({
    tree: {
      summary: { totalFiles: 1, totalFolders: 0, totalSizeKb: 1, topExtensions: {} },
      topLevelFolders: [],
      allRelativePaths: paths,
      largestFiles: [],
      inventory,
    },
    repositoryModel: { ...baseModel, fileIndex: {} },
    analyzableSourceFiles: 0,
    protectedFileCount: 0,
    commitSha: "abc",
    warnings: [],
    analyzedSourceFiles: 0,
    analysisComplete: true,
  });
  assert.equal(coverage.coverageStatus, "FAILED");
  assert.equal(coverage.readinessForFindings, false);
});

test("coverage contract reports exclusions without claiming full semantic analysis", () => {
  const inventory = inventoryFromPaths([
    "src/app.ts",
    "public/logo.png",
    "docs/readme.md",
    "vendor/lib.js",
  ]);
  const contract = buildCoverageContract({
    inventory,
    analyzedSourceFiles: 1,
    entryPointsDetected: 0,
    commitSha: "deadbeef",
    analysisComplete: true,
  });
  assert.equal(contract.supportedSourceFiles, 1);
  assert.equal(contract.binaryFilesExcluded, 1);
  assert.ok(contract.unsupportedFiles >= 1);
  assert.equal(contract.claimsSemanticAnalysisOfAllFiles, false);
  assert.equal(contract.coverageStatus, "COMPLETE_FOR_SUPPORTED_SCOPE");
});

console.log("intelligence-manifest: all passed");
