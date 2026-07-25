import assert from "node:assert/strict";
import {
  buildTriageCoverage,
  emptyCoverage,
  type QuickTriageCoverage,
} from "../src/lib/a2mcp/quick-triage-bounded";
import type { FullRepositoryInventory, InventoryFileRecord } from "../src/lib/scanner/inventory";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function file(path: string, kind: InventoryFileRecord["kind"]): InventoryFileRecord {
  return {
    path,
    sizeBytes: 100,
    extension: path.includes(".") ? path.slice(path.lastIndexOf(".")) : "",
    language: kind === "supported_source" ? "typescript" : "other",
    kind,
    generated: kind === "generated",
    binary: kind === "binary",
    vendored: kind === "vendor",
    protected: kind === "protected",
    configuration: kind === "configuration",
    testOrFixture: kind === "test" || kind === "fixture",
    routeCandidate: false,
    entryPointCandidate: false,
  };
}

function inventoryOf(files: InventoryFileRecord[]): FullRepositoryInventory {
  return {
    files,
    allRelativePaths: files.map((f) => f.path),
    topLevelFolders: ["src"],
    skippedDirectories: [],
    totalBytes: files.length * 100,
  };
}

console.log("Quick Triage coverage truthfulness");

test("zero findings can still report nonzero inspected files", () => {
  const inventory = inventoryOf([
    file("src/a.ts", "supported_source"),
    file("src/b.ts", "supported_source"),
    file("src/c.ts", "supported_source"),
  ]);
  const coverage = buildTriageCoverage({ inventory, commitSha: "abc123", partial: false });
  // No findings were ever passed to buildTriageCoverage — it derives purely from inventory.
  assert.equal(coverage.filesInspected, 3);
  assert.equal(coverage.supportedFilesAnalyzed, 3);
  assert.equal(coverage.state, "complete");
});

test("finding count does not control inspected-file count", () => {
  const inventory = inventoryOf([
    file("src/a.ts", "supported_source"),
    file("src/b.ts", "supported_source"),
  ]);
  const coverageA = buildTriageCoverage({ inventory, commitSha: "sha1", partial: false });
  const coverageB = buildTriageCoverage({ inventory, commitSha: "sha1", partial: false });
  // Identical inventory must yield identical filesInspected regardless of any
  // hypothetical difference in findings produced from it.
  assert.equal(coverageA.filesInspected, coverageB.filesInspected);
  assert.equal(coverageA.filesInspected, 2);
});

test("bounded scans report partial coverage honestly when over cap", () => {
  const many: InventoryFileRecord[] = [];
  for (let i = 0; i < 850; i++) {
    many.push(file(`src/file${i}.ts`, "supported_source"));
  }
  const inventory = inventoryOf(many);
  const coverage = buildTriageCoverage({ inventory, commitSha: "sha2", partial: false });
  assert.equal(coverage.state, "partial");
  assert.equal(coverage.filesInspected, 800);
  assert.equal(coverage.filesDiscovered, 850);
  assert.ok(coverage.filesSkipped >= 50);
  assert.ok(
    coverage.skippedClassifications.some((c) => c.kind === "supported_source_over_cap"),
    "must classify over-cap files explicitly"
  );
  assert.ok(coverage.limitations.some((l) => l.includes("only the first 800 were inspected")));
});

test("unavailable scans do not claim full success", () => {
  const coverage: QuickTriageCoverage = emptyCoverage(
    "unavailable",
    "unavailable",
    ["Repository fetch exceeded budget or repository unavailable."],
    "unavailable"
  );
  assert.equal(coverage.state, "unavailable");
  assert.equal(coverage.filesInspected, 0);
  assert.notEqual(coverage.state, "complete");
});

test("unsupported/skipped files are classified with reasons, not silently dropped", () => {
  const inventory = inventoryOf([
    file("src/a.ts", "supported_source"),
    file("README.md", "documentation"),
    file("logo.png", "binary"),
    file("vendor/lib.js", "vendor"),
  ]);
  const coverage = buildTriageCoverage({ inventory, commitSha: "sha3", partial: false });
  assert.equal(coverage.filesDiscovered, 4);
  assert.equal(coverage.filesInspected, 1);
  assert.equal(coverage.filesSkipped, 3);
  const kinds = coverage.skippedClassifications.map((c) => c.kind).sort();
  assert.deepEqual(kinds, ["binary", "documentation", "vendor"]);
  for (const entry of coverage.skippedClassifications) {
    assert.ok(entry.reason.length > 0);
  }
});

test("coverage stays bound to the exact commit passed in", () => {
  const inventory = inventoryOf([file("src/a.ts", "supported_source")]);
  const coverage = buildTriageCoverage({
    inventory,
    commitSha: "d3adb33fd3adb33fd3adb33fd3adb33fd3adb33f",
    partial: false,
  });
  assert.equal(coverage.commitSha, "d3adb33fd3adb33fd3adb33fd3adb33fd3adb33f");
});

test("analysis-budget partial is honestly reported even with full inventory coverage", () => {
  const inventory = inventoryOf([
    file("src/a.ts", "supported_source"),
    file("src/b.ts", "supported_source"),
  ]);
  const coverage = buildTriageCoverage({ inventory, commitSha: "sha4", partial: true });
  assert.equal(coverage.state, "partial");
  assert.ok(coverage.limitations.some((l) => l.includes("partial evidence only")));
});

console.log("Quick Triage coverage truthfulness: all passed");
