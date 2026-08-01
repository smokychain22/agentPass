import assert from "node:assert/strict";
import {
  resolveValidatedDeliveryOps,
  normalizeApprovedPaths,
} from "../src/lib/operator/delivery-operations";
import { ToolExecutionError } from "../src/lib/a2mcp/errors";
import { assertOperationsWithinAuthorizedScope } from "../src/lib/patch-kit/patch-kit-engine";
import type { PatchKitPayload } from "../src/lib/patch-kit/types";
import type { Finding } from "../src/lib/findings/types";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("delivery-operations");

const basePatchKit = {
  summary: { deletedPaths: ["src/archive/OldDashboard.backup.tsx"], filesDeleted: 1 },
  changeOperations: [
    {
      id: "1",
      findingIds: ["f1"],
      transformerId: "t",
      type: "delete" as const,
      filePath: "src/archive/OldDashboard.backup.tsx",
      baseBlobSha: null,
      baseContentHash: null,
      beforeContent: "x",
      afterContent: null,
      linesAdded: 0,
      linesRemoved: 1,
    },
  ],
} as unknown as PatchKitPayload;

test("splits empty-content validated edits into delete paths", () => {
  const ops = resolveValidatedDeliveryOps(basePatchKit, [
    { path: "src/components/Dashboard.tsx", content: "edited" },
    { path: "src/archive/OldDashboard.backup.tsx", content: "" },
  ]);
  assert.equal(ops.contentEdits.length, 1);
  assert.equal(ops.contentEdits[0]?.path, "src/components/Dashboard.tsx");
  assert.deepEqual(ops.deletePaths, ["src/archive/OldDashboard.backup.tsx"]);
});

test("blocks non-archive delete paths at operator gate", () => {
  const ops = resolveValidatedDeliveryOps(
    {
      ...basePatchKit,
      summary: { deletedPaths: ["src/components/Unused.tsx"] },
      changeOperations: [],
    } as unknown as PatchKitPayload,
    [{ path: "src/components/Unused.tsx", content: "" }]
  );
  assert.equal(ops.deletePaths.length, 0);
  assert.equal(ops.skippedDeletePaths.length, 1);
});

test("allows an explicitly approved validated script deletion", () => {
  const patchKit = {
    ...basePatchKit,
    summary: { deletedPaths: ["scripts/test-unused.mjs"] },
    changeOperations: [
      {
        ...basePatchKit.changeOperations![0],
        filePath: "scripts/test-unused.mjs",
      },
    ],
  } as unknown as PatchKitPayload;

  const ops = resolveValidatedDeliveryOps(
    patchKit,
    [{ path: "scripts/test-unused.mjs", content: "" }],
    ["scripts/test-unused.mjs"]
  );

  assert.deepEqual(ops.deletePaths, ["scripts/test-unused.mjs"]);
  assert.deepEqual(ops.skippedDeletePaths, []);
});

test("explicit approval cannot bypass protected configuration paths", () => {
  const patchKit = {
    ...basePatchKit,
    summary: { deletedPaths: ["package.json"] },
    changeOperations: [
      {
        ...basePatchKit.changeOperations![0],
        filePath: "package.json",
      },
    ],
  } as unknown as PatchKitPayload;

  const ops = resolveValidatedDeliveryOps(
    patchKit,
    [{ path: "package.json", content: "" }],
    ["package.json"]
  );

  assert.deepEqual(ops.deletePaths, []);
  assert.deepEqual(ops.skippedDeletePaths, ["package.json"]);
});

// --- approvedPaths integration: /api/github/create-cleanup-pr previously
// had no way to forward explicit owner approval into
// resolveValidatedDeliveryOps, so an ordinary source-file deletion could
// never leave NO_SAFE_CANDIDATES even after real Git validation passed. ---

function patchKitFor(opts: {
  candidateDeletes: string[];
  validatedPaths?: string[];
}): PatchKitPayload {
  return {
    summary: { deletedPaths: opts.candidateDeletes },
    changeOperations: [],
    ...(opts.validatedPaths
      ? { patchValidation: { status: "passed", validatedPaths: opts.validatedPaths } }
      : {}),
  } as unknown as PatchKitPayload;
}

test("1. an ordinary validated source-file delete remains blocked without explicit approvedPaths", () => {
  const patchKit = patchKitFor({
    candidateDeletes: ["src/unused/confirmed-unused.ts"],
    validatedPaths: ["src/unused/confirmed-unused.ts"],
  });
  const ops = resolveValidatedDeliveryOps(patchKit, [], []);
  assert.deepEqual(ops.deletePaths, []);
  assert.deepEqual(ops.skippedDeletePaths, ["src/unused/confirmed-unused.ts"]);
});

test("2. the same deletion succeeds once explicitly approved, in generated operations, and sandbox-validated", () => {
  const patchKit = patchKitFor({
    candidateDeletes: ["src/unused/confirmed-unused.ts"],
    validatedPaths: ["src/unused/confirmed-unused.ts"],
  });
  const ops = resolveValidatedDeliveryOps(patchKit, [], ["src/unused/confirmed-unused.ts"]);
  assert.deepEqual(ops.deletePaths, ["src/unused/confirmed-unused.ts"]);
  assert.deepEqual(ops.skippedDeletePaths, []);
});

test("3. an approved path absent from generated operations fails", () => {
  const patchKit = patchKitFor({
    candidateDeletes: ["src/unused/confirmed-unused.ts"],
    validatedPaths: ["src/unused/confirmed-unused.ts", "src/never-generated.ts"],
  });
  const ops = resolveValidatedDeliveryOps(patchKit, [], ["src/never-generated.ts"]);
  assert.deepEqual(ops.deletePaths, [], "a path the patch kit never generated must never be delivered");
});

test("4. an approved path absent from sandbox-validated paths fails, even though it was generated", () => {
  // Simulates a multi-file patch kit where generation proposed two paths but
  // the sandbox's real git-apply validation only confirmed one of them.
  const patchKit = patchKitFor({
    candidateDeletes: ["src/unused/confirmed-unused.ts", "src/unused/empty-module.ts"],
    validatedPaths: ["src/unused/confirmed-unused.ts"], // empty-module.ts was NOT validated
  });
  const ops = resolveValidatedDeliveryOps(patchKit, [], ["src/unused/empty-module.ts"]);
  assert.deepEqual(
    ops.deletePaths,
    [],
    "approval cannot bridge the gap between what was generated and what the sandbox actually validated"
  );
});

test("5. a foreign finding's path fails — it was never part of this patch kit's own generated operations", () => {
  const patchKit = patchKitFor({
    candidateDeletes: ["src/unused/confirmed-unused.ts"],
    validatedPaths: ["src/unused/confirmed-unused.ts"],
  });
  const ops = resolveValidatedDeliveryOps(patchKit, [], ["src/config/runtime-hook.ts"]);
  assert.deepEqual(ops.deletePaths, [], "a path from a different finding was never generated by this patch kit");
});

test("6. a stale-scan path fails — the loaded patch kit's own operations define the only approvable universe", () => {
  const staleKit = patchKitFor({
    candidateDeletes: ["src/unused/confirmed-unused.ts"],
    validatedPaths: ["src/unused/confirmed-unused.ts"],
  });
  const ops = resolveValidatedDeliveryOps(staleKit, [], ["src/from-a-later-rescan.ts"]);
  assert.deepEqual(ops.deletePaths, []);
});

test("7. a different-repository path fails — never present in this repository's own patch kit", () => {
  const patchKit = patchKitFor({
    candidateDeletes: ["src/unused/confirmed-unused.ts"],
    validatedPaths: ["src/unused/confirmed-unused.ts"],
  });
  const ops = resolveValidatedDeliveryOps(patchKit, [], ["src/other-repository-file.ts"]);
  assert.deepEqual(ops.deletePaths, []);
});

test("8. a different-base-commit path fails — never present in this commit's own patch kit", () => {
  const patchKit = patchKitFor({
    candidateDeletes: ["src/unused/confirmed-unused.ts"],
    validatedPaths: ["src/unused/confirmed-unused.ts"],
  });
  const ops = resolveValidatedDeliveryOps(patchKit, [], ["src/file-only-at-a-different-commit.ts"]);
  assert.deepEqual(ops.deletePaths, []);
});

test("9. a protected path fails despite explicit approval, even a category not covered by the earlier test (.env)", () => {
  const patchKit = patchKitFor({
    candidateDeletes: [".env.production"],
    validatedPaths: [".env.production"],
  });
  const ops = resolveValidatedDeliveryOps(patchKit, [], [".env.production"]);
  assert.deepEqual(ops.deletePaths, []);
  assert.deepEqual(ops.skippedDeletePaths, [".env.production"]);
});

test("10. absolute paths and traversal paths fail loudly rather than being silently dropped", () => {
  for (const bad of ["/etc/passwd", "../../etc/passwd", "src/../../etc/passwd", "C:\\Windows\\System32\\x"]) {
    assert.throws(
      () => normalizeApprovedPaths([bad]),
      (err: unknown) => err instanceof ToolExecutionError && err.code === "INVALID_INPUT",
      `expected "${bad}" to be rejected`
    );
  }
});

test("11. whitespace-only approval input fails when approval was explicitly supplied", () => {
  assert.throws(
    () => normalizeApprovedPaths(["   ", ""]),
    (err: unknown) => err instanceof ToolExecutionError && err.code === "INVALID_INPUT"
  );
  // Omitting approval entirely (or passing an empty array) is unaffected.
  assert.deepEqual(normalizeApprovedPaths(undefined), []);
  assert.deepEqual(normalizeApprovedPaths([]), []);
});

test("12. duplicate approved paths normalize to one without widening scope", () => {
  const normalized = normalizeApprovedPaths(["src/a.ts", "src/a.ts", " src/a.ts ", "src\\a.ts"]);
  assert.deepEqual(normalized, ["src/a.ts"]);
});

test("13. multiple approved paths can never cause an unselected operation to appear", () => {
  const patchKit = patchKitFor({
    candidateDeletes: ["src/unused/confirmed-unused.ts"],
    validatedPaths: ["src/unused/confirmed-unused.ts"],
  });
  const ops = resolveValidatedDeliveryOps(
    patchKit,
    [],
    ["src/unused/confirmed-unused.ts", "src/never-generated-a.ts", "src/never-generated-b.ts"]
  );
  assert.deepEqual(
    ops.deletePaths,
    ["src/unused/confirmed-unused.ts"],
    "only the path that was actually generated and validated may be delivered, regardless of how many extra paths were approved"
  );
});

test("14. existing operator-safe default deletions remain unaffected by the new sandbox-validated-paths gate", () => {
  // patchValidation.validatedPaths is present but does NOT include the
  // operator-safe path — proving the new gate is scoped to the approved
  // branch only, never to the pre-existing default-safe branch.
  const patchKit = patchKitFor({
    candidateDeletes: ["src/archive/OldDashboard.backup.tsx"],
    validatedPaths: ["src/unused/confirmed-unused.ts"],
  });
  const ops = resolveValidatedDeliveryOps(patchKit, [], []);
  assert.deepEqual(ops.deletePaths, ["src/archive/OldDashboard.backup.tsx"]);
});

test("15. a duplicate-consolidation companion edit correctly attributed to the authorized finding remains valid", () => {
  const authorized: Finding[] = [
    {
      id: "dup",
      title: "Duplicate code cluster",
      type: "duplicate_code",
      files: ["src/components/StatusCard.tsx", "src/components/StatusCardCopy.tsx"],
      confidence: 0.9,
      confidenceReason: "test",
      severity: "medium",
      reason: "test",
      source: "jscpd",
      sourceMode: "native",
      action: "safe_candidate",
      evidence: { summary: "test", signals: [] },
    },
  ];
  assert.doesNotThrow(() =>
    assertOperationsWithinAuthorizedScope({
      authorizedFindings: authorized,
      operations: [
        { filePath: "src/components/StatusCardCopy.tsx", findingIds: ["dup"], type: "delete" },
        { filePath: "src/components/LegacyStatusPanel.tsx", findingIds: ["dup"], type: "edit" },
      ],
    })
  );
});

console.log("delivery-operations: all passed");
