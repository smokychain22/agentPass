import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  FORBIDDEN_BARE_OUTCOMES,
  assertValidTerminalOutcome,
  isForbiddenBareOutcome,
  parseGitLsTreeZ,
  reconcileGitTreeWithWorktree,
  applyFallbackChainToInventory,
  buildUniversalCoverageReport,
  discoverRepositoryTopology,
  legacyCoverageReport,
  ANALYZER_REGISTRY,
  FALLBACK_LAYER_ORDER,
  detectLfsPointerContent,
  normalizeRepoRelativePath,
} from "../src/lib/coverage";
import type { GitTreeEntry } from "../src/lib/coverage/git-tree-inventory";
import {
  assertValidCleanupSelection,
  FindingSelectionValidationError,
} from "../src/lib/findings/selection";
import { isCleanupEligible } from "../src/lib/findings/cleanup-eligibility";
import { normalizeFindings } from "../src/lib/findings/normalize-findings";
import type { Finding, FindingsPayload } from "../src/lib/findings/types";
import { finalizeAnalyzerResult } from "../src/lib/findings/analyzer-result";

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      throw err;
    });
}

function treeEntry(
  partial: Pick<GitTreeEntry, "path" | "sha"> & Partial<GitTreeEntry>
): GitTreeEntry {
  return {
    mode: partial.mode ?? "100644",
    type: partial.type ?? "blob",
    path: partial.path,
    sha: partial.sha,
    size: partial.size ?? 12,
  };
}

async function withTempWorktree(
  files: Record<string, string | Buffer>,
  run: (root: string) => Promise<void>
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-cov-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(root, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content);
    }
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

console.log("universal-coverage-phase1");

async function main() {
await test("no_bare_SKIPPED_IGNORED_UNSUPPORTED_UNKNOWN_outcomes", () => {
  for (const bare of FORBIDDEN_BARE_OUTCOMES) {
    assert.equal(isForbiddenBareOutcome(bare), true);
    assert.throws(() => assertValidTerminalOutcome(bare));
  }
  assertValidTerminalOutcome("SEMANTICALLY_ANALYZED");
  assertValidTerminalOutcome("GENERATED_CLASSIFIED");
});

await test("pinned_commit_inventory_matches_git_ls_tree", () => {
  const sha = "a".repeat(40);
  const buf = Buffer.from(
    [
      `100644 blob ${sha}      11\tREADME.md`,
      `100644 blob ${sha}       3\tsrc/app.ts`,
      `100755 blob ${sha}       8\tscripts/run.sh`,
      `120000 blob ${sha}       5\tlink-to-readme`,
      `160000 commit ${"b".repeat(40)}       -\tvendor/lib`,
    ].join("\0") + "\0"
  );
  const entries = parseGitLsTreeZ(buf);
  assert.equal(entries.length, 5);
  assert.equal(entries[0]!.path, "README.md");
  assert.equal(entries[2]!.mode, "100755");
  assert.equal(entries[3]!.mode, "120000");
  assert.equal(entries[4]!.type, "commit");
  // Unusual path characters
  const weird = parseGitLsTreeZ(
    Buffer.from(`100644 blob ${sha}       1\tpath with spaces/ünicode.file\0`)
  );
  assert.equal(weird[0]!.path, "path with spaces/ünicode.file");
  assert.equal(normalizeRepoRelativePath("a\\b"), "a/b");
});

await test("every_tracked_path_exactly_one_terminal_coverage_outcome", async () => {
  const sha = "c".repeat(40);
  await withTempWorktree(
    {
      "README.md": "# docs only\n",
      "src/app.ts": "export const x = 1;\n",
      "dist/bundle.js": "/* generated */\n",
      "vendor/lib/index.js": "module.exports = {};\n",
      "assets/logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      "notes.txt": "plain text\n",
      "package.json": '{"name":"cov-fixture"}\n',
    },
    async (root) => {
      const entries: GitTreeEntry[] = [
        treeEntry({ path: "README.md", sha }),
        treeEntry({ path: "src/app.ts", sha }),
        treeEntry({ path: "dist/bundle.js", sha }),
        treeEntry({ path: "vendor/lib/index.js", sha }),
        treeEntry({ path: "assets/logo.png", sha, size: 4 }),
        treeEntry({ path: "notes.txt", sha }),
        treeEntry({ path: "package.json", sha }),
        treeEntry({ path: "missing-from-zip.ts", sha }),
      ];
      const reconciled = await reconcileGitTreeWithWorktree({
        entries,
        worktreeRoot: root,
        owner: "velz-cmd",
        repository: "coverage-fixture",
        pinnedCommitSha: sha,
        treeSha: "d".repeat(40),
      });
      assert.equal(reconciled.inventory.length, entries.length);
      const chained = applyFallbackChainToInventory(reconciled.inventory, {
        jsTsSemanticSucceeded: true,
        owner: "velz-cmd",
        repository: "coverage-fixture",
        pinnedCommitSha: sha,
      });
      const report = buildUniversalCoverageReport({
        inventory: chained.inventory,
        attempts: chained.attempts,
        nonAuthoritativeWorktreeArtifacts: reconciled.nonAuthoritativeArtifacts,
        materializationMismatchCount: reconciled.materializationMismatchCount,
      });
      assert.equal(report.trackedGitPaths, report.accountedForPaths);
      assert.equal(report.accountedForPaths, report.inventory.length);
      assert.equal(report.accountingCoveragePercent, 100);
      assert.equal(report.claimsSemanticAnalysisOfAllFiles, false);
      const paths = new Set(report.inventory.map((e) => e.pathExact));
      assert.equal(paths.size, report.inventory.length);
      for (const entry of report.inventory) {
        assertValidTerminalOutcome(entry.finalCoverageOutcome);
        assert.equal(isForbiddenBareOutcome(entry.finalCoverageOutcome), false);
      }
    }
  );
});

await test("generated_tree_contents_remain_in_inventory", async () => {
  const sha = "e".repeat(40);
  await withTempWorktree({ "dist/a.js": "1", "dist/b.js": "2" }, async (root) => {
    const entries = [
      treeEntry({ path: "dist/a.js", sha }),
      treeEntry({ path: "dist/b.js", sha }),
    ];
    const reconciled = await reconcileGitTreeWithWorktree({
      entries,
      worktreeRoot: root,
      owner: "o",
      repository: "r",
      pinnedCommitSha: sha,
    });
    assert.equal(reconciled.inventory.length, 2);
    assert.ok(
      reconciled.inventory.every((e) => e.finalCoverageOutcome === "GENERATED_CLASSIFIED")
    );
  });
});

await test("vendored_tree_contents_remain_in_inventory", async () => {
  const sha = "f".repeat(40);
  await withTempWorktree({ "vendor/pkg/x.js": "1" }, async (root) => {
    const reconciled = await reconcileGitTreeWithWorktree({
      entries: [treeEntry({ path: "vendor/pkg/x.js", sha })],
      worktreeRoot: root,
      owner: "o",
      repository: "r",
      pinnedCommitSha: sha,
    });
    assert.equal(reconciled.inventory[0]!.finalCoverageOutcome, "VENDORED_CLASSIFIED");
  });
});

await test("symlink_is_accounted_for_without_unsafe_follow", async () => {
  const sha = "1".repeat(40);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-symlink-"));
  try {
    await fs.writeFile(path.join(root, "target.txt"), "hi");
    await fs.symlink("target.txt", path.join(root, "link.txt"));
    const reconciled = await reconcileGitTreeWithWorktree({
      entries: [
        treeEntry({ path: "target.txt", sha }),
        treeEntry({ path: "link.txt", sha, mode: "120000", size: 10 }),
      ],
      worktreeRoot: root,
      owner: "o",
      repository: "r",
      pinnedCommitSha: sha,
    });
    const link = reconciled.inventory.find((e) => e.pathExact === "link.txt")!;
    assert.equal(link.symlink, true);
    assert.equal(link.materializationStatus, "SYMLINK_REPRESENTED");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

await test("submodule_gitlink_is_accounted_for", async () => {
  const sha = "2".repeat(40);
  await withTempWorktree({}, async (root) => {
    const reconciled = await reconcileGitTreeWithWorktree({
      entries: [
        treeEntry({
          path: "third_party/mod",
          sha: "3".repeat(40),
          mode: "160000",
          type: "commit",
          size: 0,
        }),
      ],
      worktreeRoot: root,
      owner: "o",
      repository: "r",
      pinnedCommitSha: sha,
    });
    assert.equal(reconciled.inventory[0]!.submodule, true);
    const chained = applyFallbackChainToInventory(reconciled.inventory, {
      pinnedCommitSha: sha,
    });
    assert.equal(chained.inventory[0]!.finalCoverageOutcome, "METADATA_ANALYZED");
  });
});

await test("git_lfs_pointer_is_accounted_for", async () => {
  const pointer = `version https://git-lfs.github.com/spec/v1
oid sha256:${"a".repeat(64)}
size 12345
`;
  assert.equal(detectLfsPointerContent(pointer), true);
  const sha = "4".repeat(40);
  await withTempWorktree({ "big.bin": pointer }, async (root) => {
    const reconciled = await reconcileGitTreeWithWorktree({
      entries: [treeEntry({ path: "big.bin", sha, size: pointer.length })],
      worktreeRoot: root,
      owner: "o",
      repository: "r",
      pinnedCommitSha: sha,
    });
    assert.equal(reconciled.inventory[0]!.materializationStatus, "LFS_POINTER");
  });
});

await test("binary_receives_explicit_outcome", async () => {
  const sha = "5".repeat(40);
  await withTempWorktree(
    { "img.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]) },
    async (root) => {
      const reconciled = await reconcileGitTreeWithWorktree({
        entries: [treeEntry({ path: "img.png", sha })],
        worktreeRoot: root,
        owner: "o",
        repository: "r",
        pinnedCommitSha: sha,
      });
      assert.equal(reconciled.inventory[0]!.finalCoverageOutcome, "BINARY_INSPECTED");
    }
  );
});

await test("unknown_text_receives_textual_or_metadata_outcome", async () => {
  const sha = "6".repeat(40);
  await withTempWorktree({ "weird.unknownext": "hello world\n" }, async (root) => {
    const reconciled = await reconcileGitTreeWithWorktree({
      entries: [treeEntry({ path: "weird.unknownext", sha })],
      worktreeRoot: root,
      owner: "o",
      repository: "r",
      pinnedCommitSha: sha,
    });
    const chained = applyFallbackChainToInventory(reconciled.inventory, {
      jsTsSemanticSucceeded: false,
      pinnedCommitSha: sha,
    });
    const outcome = chained.inventory[0]!.finalCoverageOutcome;
    assert.ok(
      outcome === "TEXTUALLY_ANALYZED" || outcome === "METADATA_ANALYZED",
      outcome
    );
  });
});

await test("unusual_path_characters_inventory_safe", () => {
  const p = normalizeRepoRelativePath("docs/My File (1).md");
  assert.equal(p, "docs/My File (1).md");
  assert.throws(() => normalizeRepoRelativePath("../escape"));
  assert.throws(() => normalizeRepoRelativePath("/abs"));
});

await test("multi_root_topology_detected", () => {
  const topo = discoverRepositoryTopology([
    "package.json",
    "apps/web/package.json",
    "pnpm-workspace.yaml",
    "services/api/go.mod",
    "infra/main.tf",
    ".github/workflows/ci.yml",
  ]);
  assert.ok(topo.manifests.length >= 4);
  assert.ok(topo.projectRoots.length >= 1);
});

await test("no_manifest_repository_still_reaches_100_percent_accounting", async () => {
  const sha = "7".repeat(40);
  await withTempWorktree({ "README": "hi\n" }, async (root) => {
    const reconciled = await reconcileGitTreeWithWorktree({
      entries: [treeEntry({ path: "README", sha })],
      worktreeRoot: root,
      owner: "o",
      repository: "r",
      pinnedCommitSha: sha,
    });
    const chained = applyFallbackChainToInventory(reconciled.inventory, {
      jsTsSemanticSucceeded: false,
    });
    const report = buildUniversalCoverageReport({
      inventory: chained.inventory,
      attempts: chained.attempts,
    });
    assert.equal(report.accountingCoveragePercent, 100);
    assert.equal(report.claimsSemanticAnalysisOfAllFiles, false);
  });
});

await test("analyzer_failure_records_fallback_and_final_outcome", () => {
  assert.deepEqual(FALLBACK_LAYER_ORDER, [
    "semantic",
    "structural",
    "textual",
    "metadata",
  ]);
  assert.ok(ANALYZER_REGISTRY.knip.fallbackAnalyzers.includes("internal_import_graph"));
  const entry = {
    pathExact: "src/x.py",
    pathNormalized: "src/x.py",
    objectType: "blob" as const,
    objectSha: "8".repeat(40),
    mode: "100644",
    executable: false,
    symlink: false,
    submodule: false,
    byteSize: 10,
    materializationStatus: "MATERIALIZED" as const,
    analyzerPlan: {
      primaryLayer: "semantic" as const,
      fallbackLayers: ["textual" as const, "metadata" as const],
    },
    finalCoverageOutcome: "SEMANTICALLY_ANALYZED" as const,
    owner: "o",
    repository: "r",
    pinnedCommitSha: "9".repeat(40),
    contentInspected: true,
  };
  const { inventory, attempts } = applyFallbackChainToInventory([entry], {
    jsTsSemanticSucceeded: false,
  });
  assert.ok(attempts.length >= 1);
  assert.ok(
    inventory[0]!.finalCoverageOutcome === "TEXTUALLY_ANALYZED" ||
      inventory[0]!.finalCoverageOutcome === "METADATA_ANALYZED"
  );
});

await test("jscpd_fallback_is_normalized", () => {
  const jscpdFallback = finalizeAnalyzerResult(
    "jscpd",
    "fallback",
    {
      duplicates: [
        {
          lines: 8,
          firstFile: { name: "src/a.ts", start: 1, end: 8 },
          secondFile: { name: "src/b.ts", start: 1, end: 8 },
        },
      ],
    },
    "native failed",
    10
  );
  const payload = normalizeFindings({
    scanId: "scan_t",
    repo: { owner: "o", name: "r", branch: "main", url: "https://github.com/o/r" },
    rootDir: "/tmp/repo",
    knip: null,
    knipResult: finalizeAnalyzerResult("knip", "failed", null, "x", 1) as any,
    jscpd: jscpdFallback.report,
    jscpdResult: jscpdFallback,
    madge: null,
    madgeResult: finalizeAnalyzerResult("madge", "failed", null, "x", 1) as any,
    slop: [],
    mode: "live",
  });
  assert.ok(payload.duplicates.length >= 1);
  assert.equal(payload.duplicates[0]!.source, "jscpd_fallback");
  assert.equal(payload.duplicates[0]!.action, "review_first");
});

await test("madge_fallback_is_normalized", () => {
  const madgeFallback = finalizeAnalyzerResult(
    "madge",
    "fallback",
    { orphans: ["src/orphan.ts"], circular: [] },
    "native failed",
    10
  );
  const payload = normalizeFindings({
    scanId: "scan_t",
    repo: { owner: "o", name: "r", branch: "main", url: "https://github.com/o/r" },
    rootDir: "/tmp/repo",
    knip: null,
    knipResult: finalizeAnalyzerResult("knip", "failed", null, "x", 1) as any,
    jscpd: null,
    jscpdResult: finalizeAnalyzerResult("jscpd", "failed", null, "x", 1) as any,
    madge: madgeFallback.report,
    madgeResult: madgeFallback,
    slop: [],
    mode: "live",
  });
  assert.ok(payload.orphans.length >= 1);
  assert.equal(payload.orphans[0]!.source, "madge_fallback");
});

await test("knip_missing_package_json_invokes_fallback", async () => {
  const { runKnip } = await import("../src/lib/findings/run-knip");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-nokpkg-"));
  try {
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src/a.ts"), "export const a = 1;\n");
    const result = await runKnip(root);
    assert.ok(result.status === "fallback" || result.status === "failed");
    if (result.status === "fallback") {
      assert.ok(result.report);
      assert.match(result.error ?? "", /import-graph fallback|No package\.json/i);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

await test("resource_limit_emits_explicit_outcome", async () => {
  const sha = "a1".padEnd(40, "0");
  await withTempWorktree({}, async (root) => {
    const reconciled = await reconcileGitTreeWithWorktree({
      entries: [treeEntry({ path: "ghost.ts", sha })],
      worktreeRoot: root,
      owner: "o",
      repository: "r",
      pinnedCommitSha: sha,
    });
    assert.equal(reconciled.inventory[0]!.finalCoverageOutcome, "UNREADABLE_WITH_REASON");
    assert.ok(reconciled.materializationMismatchCount >= 1);
  });
});

await test("legacy_scan_not_falsely_marked_complete", () => {
  const legacy = legacyCoverageReport();
  assert.equal(legacy.coverageVersion, "legacy");
  assert.equal(legacy.accountingCoveragePercent, 0);
  assert.equal(legacy.claimsSemanticAnalysisOfAllFiles, false);
  assert.equal(legacy.trackedGitPaths, 0);
});

await test("cleanup_eligibility_requires_existing_transformer_preflight", () => {
  const finding: Finding = {
    id: "f1",
    title: "t",
    type: "unused_file",
    files: ["src/unused/empty-module.ts"],
    confidence: 0.99,
    confidenceReason: "t",
    severity: "low",
    reason: "t",
    action: "safe_candidate",
    source: "knip",
    sourceMode: "native",
    evidence: {
      summary: "t",
      signals: ["classification=actionable_candidate", "unused"],
    },
  };
  // Coverage outcome must not make this eligible without transformer availability.
  assert.equal(isCleanupEligible(finding), false);
});

await test("review_first_not_auto_promoted_to_safe", () => {
  const finding: Finding = {
    id: "f2",
    title: "t",
    type: "orphan_pattern",
    files: ["src/orphan.ts"],
    confidence: 0.9,
    confidenceReason: "t",
    severity: "low",
    reason: "t",
    action: "review_first",
    source: "madge_fallback",
    sourceMode: "fallback",
    evidence: { summary: "t", signals: ["unused"] },
  };
  assert.equal(finding.action, "review_first");
  assert.equal(isCleanupEligible(finding), false);
});

await test("server_cleanup_validation_remains_fail_closed", () => {
  const payload = {
    scanId: "scan_t",
    mode: "live",
    repo: {
      owner: "o",
      name: "r",
      url: "https://github.com/o/r",
      branch: "main",
      commitSha: "abc",
    },
    summary: {
      totalFindings: 1,
      duplicateClusters: 0,
      unusedFiles: 0,
      unusedDependencies: 0,
      unusedExports: 0,
      orphanPatterns: 1,
      slopSignals: 0,
      reviewRequired: 1,
      safeCandidates: 0,
      doNotTouch: 0,
    },
    duplicates: [],
    unused: { files: [], dependencies: [], exports: [] },
    orphans: [
      {
        id: "rev1",
        title: "Disconnected",
        type: "orphan_pattern",
        files: ["src/x.ts"],
        confidence: 0.7,
        confidenceReason: "t",
        severity: "low",
        reason: "t",
        action: "review_first",
        source: "madge_fallback",
        sourceMode: "fallback",
        evidence: { summary: "t", signals: [] },
      },
    ],
    slopSignals: [],
    riskBuckets: { safeDelete: [], reviewFirst: ["rev1"], doNotTouch: [] },
    artifacts: { findingsJson: true },
    rawToolReports: {
      knip: { status: "failed", source: "knip", sourceMode: "native", durationMs: 1 },
      jscpd: { status: "failed", source: "jscpd", sourceMode: "native", durationMs: 1 },
      madge: { status: "fallback", source: "madge", sourceMode: "fallback", durationMs: 1 },
    },
  } as FindingsPayload;

  assert.throws(
    () =>
      assertValidCleanupSelection({
        findings: payload,
        selectedFindingIds: ["rev1"],
      }),
    (err: unknown) =>
      err instanceof FindingSelectionValidationError && err.code === "FINDING_REVIEW_FIRST"
  );
});

console.log("universal-coverage-phase1: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
