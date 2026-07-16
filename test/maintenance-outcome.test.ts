import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FindingsPayload, Finding } from "../src/lib/findings/types";
import type { ChangeOperation } from "../src/lib/patch-kit/canonical-patch";
import { buildMaintenanceOutcome } from "../src/lib/maintenance/outcome";
import { enrichExactDuplicateFindings } from "../src/lib/findings/enrich-exact-duplicates";
import { applyConsolidateExactDuplicate } from "../src/lib/execution/fix-plugins/apply-extra-transforms";
import { findModuleReferences } from "../src/lib/execution/reference-graph";

function exactDuplicateFinding(id: string, duplicate: string): Finding {
  return {
    id,
    type: "duplicate_code",
    title: `Exact duplicate file: ${duplicate}`,
    files: ["src/lib/canonical.ts", duplicate],
    confidence: 0.95,
    confidenceReason: "Byte-identical file content hash match.",
    severity: "medium",
    action: "safe_candidate",
    reason: `${duplicate} is an exact duplicate of src/lib/canonical.ts.`,
    source: "repodiet_exact_dup",
    sourceMode: "native",
    evidence: {
      summary: "Exact file duplicate detected by content hash.",
      signals: [
        "exact_file_duplicate=true",
        "content_hash=abc123",
        "canonical=src/lib/canonical.ts",
        `duplicate=${duplicate}`,
      ],
    },
  };
}

const findings = {
  scanId: "scan_outcome",
  repo: {
    owner: "example",
    name: "repo",
    branch: "main",
    commitSha: "a".repeat(40),
  },
  duplicates: [
    exactDuplicateFinding("dup_1", "src/lib/copy-a.ts"),
    exactDuplicateFinding("dup_2", "src/lib/copy-b.ts"),
  ],
  unused: { files: [], dependencies: [], exports: [] },
  orphans: [],
  slopSignals: [],
} as unknown as FindingsPayload;

function operation(input: Partial<ChangeOperation> & Pick<ChangeOperation, "id" | "type" | "filePath" | "findingIds">): ChangeOperation {
  return {
    transformerId: "consolidate_exact_duplicate",
    baseBlobSha: null,
    baseContentHash: null,
    beforeContent: null,
    afterContent: null,
    linesAdded: 0,
    linesRemoved: 0,
    ...input,
  };
}

const delivered = buildMaintenanceOutcome({
  findings,
  verificationStatus: "verified",
  deliveryState: "delivered",
  changeOperations: [
    operation({ id: "delete-a", type: "delete", filePath: "src/lib/copy-a.ts", findingIds: ["dup_1"] }),
    operation({ id: "delete-b", type: "delete", filePath: "src/lib/copy-b.ts", findingIds: ["dup_2"] }),
    operation({ id: "rewire-a", type: "edit", filePath: "src/lib/consumer.ts", findingIds: ["dup_1", "dup_2"] }),
  ],
});

assert.equal(delivered.kind, "exact_duplicate_canonicalization");
assert.equal(delivered.deliveryState, "delivered");
assert.equal(delivered.headline, "3 byte-identical implementations consolidated into 1 canonical implementation");
assert.equal(delivered.canonicalizations.length, 1);
assert.deepEqual(delivered.canonicalizations[0]?.removedDuplicatePaths, [
  "src/lib/copy-a.ts",
  "src/lib/copy-b.ts",
]);
assert.deepEqual(delivered.canonicalizations[0]?.rewiredImporterPaths, ["src/lib/consumer.ts"]);
assert.equal(delivered.canonicalizations[0]?.proofBasis, "byte_identical_content_and_patch_operation");

const proposedOnly = buildMaintenanceOutcome({
  findings,
  changeOperations: [
    operation({ id: "unrelated", type: "edit", filePath: "src/lib/other.ts", findingIds: [] }),
  ],
});

assert.equal(proposedOnly.kind, "bounded_repository_cleanup");
assert.equal(proposedOnly.canonicalizations.length, 0);
assert.match(proposedOnly.evidenceStatement, /no architecture-level claim/i);

async function verifiesRealThreeToOneTransform(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-canonicalization-"));
  const libDir = path.join(rootDir, "src", "lib");
  const otherDir = path.join(rootDir, "src", "other");
  await fs.mkdir(libDir, { recursive: true });
  await fs.mkdir(otherDir, { recursive: true });
  const implementation = [
    "export const VALUE = 42;",
    "export function readValue(): number { return VALUE; }",
    "",
  ].join("\n");
  await Promise.all([
    fs.writeFile(path.join(libDir, "canonical.ts"), implementation, "utf8"),
    fs.writeFile(path.join(libDir, "copy-a.ts"), implementation, "utf8"),
    fs.writeFile(path.join(libDir, "copy-b.ts"), implementation, "utf8"),
    fs.writeFile(
      path.join(otherDir, "copy-a.ts"),
      "export function readOther(): number { return 7; }\n",
      "utf8"
    ),
    fs.writeFile(
      path.join(libDir, "consumer.ts"),
      [
        'import { readValue as readA } from "./copy-a";',
        "import {",
        "  readValue as readB,",
        '} from "./copy-b";',
        'import { readOther } from "../other/copy-a";',
        'export const untouchedLabel = "./copy-a";',
        "export const combined = readA() + readB() + readOther();",
        "",
      ].join("\n"),
      "utf8"
    ),
  ]);

  try {
    const exactFindings = await enrichExactDuplicateFindings(rootDir, []);
    assert.equal(exactFindings.length, 2);
    assert.ok(
      exactFindings.every((finding) =>
        finding.evidence.signals.includes("inbound_refs_duplicate=1")
      ),
      "Both active duplicate imports must be detected before transformation"
    );
    for (const finding of exactFindings) {
      await applyConsolidateExactDuplicate(rootDir, finding, "consolidate_exact_duplicate");
    }

    const remaining = await fs.readdir(libDir);
    assert.ok(remaining.includes("canonical.ts"));
    assert.ok(!remaining.includes("copy-a.ts"));
    assert.ok(!remaining.includes("copy-b.ts"));
    const consumer = await fs.readFile(path.join(libDir, "consumer.ts"), "utf8");
    const references = findModuleReferences(consumer).map((reference) => reference.specifier);
    assert.deepEqual(references, ["./canonical", "./canonical", "../other/copy-a"]);
    assert.match(consumer, /untouchedLabel = "\.\/copy-a"/);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

verifiesRealThreeToOneTransform()
  .then(() => console.log("maintenance-outcome.test: passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
