import assert from "node:assert/strict";
import { resolveValidatedDeliveryOps } from "../src/lib/operator/delivery-operations";
import type { PatchKitPayload } from "../src/lib/patch-kit/types";

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

console.log("delivery-operations: all passed");
