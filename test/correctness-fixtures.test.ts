import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectUnusedImportsInSource,
  removeUnusedSymbolFromImport,
} from "../src/lib/findings/unused-import-detector";
import { classifyDuplicatePair } from "../src/lib/findings/duplicate-semantics";
import { resolveFileContext } from "../src/lib/repository-model/detect-entrypoints";
import type { Finding } from "../src/lib/findings/types";
import { formatRejectionReason } from "../src/lib/execution/candidate-decision";
import { checkEntitlement } from "../src/lib/entitlement/service";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures", "repositories");

function sampleFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    type: "duplicate_code",
    title: "Dup",
    files: ["apps/a/src/x.tsx"],
    confidence: 0.8,
    confidenceReason: "test",
    severity: "medium",
    action: "review_first",
    reason: "test",
    source: "jscpd",
    sourceMode: "native",
    evidence: { summary: "dup", signals: [] },
    ...overrides,
  };
}

async function run() {
  console.log("Correctness fixture tests");

  const namedImportSource = `import { Clock, Play } from "lucide-react";\n\nexport function X() { return <Play />; }\n`;
  const unused = detectUnusedImportsInSource("src/x.tsx", namedImportSource);
  assert.ok(unused.some((u) => u.symbol === "Clock"), "Clock should be unused");
  assert.ok(!unused.some((u) => u.symbol === "Play"), "Play should be used in JSX");
  const modified = removeUnusedSymbolFromImport(
    namedImportSource,
    'import { Clock, Play } from "lucide-react";',
    "Clock"
  );
  assert.match(modified, /import \{ Play \} from "lucide-react"/);
  assert.doesNotMatch(modified, /Clock/);
  console.log("  ✓ partly unused named import preserves Play");

  const sideEffect = `import "polyfill";\nconsole.log("x");\n`;
  const sideUnused = detectUnusedImportsInSource("src/y.ts", sideEffect);
  assert.equal(sideUnused.length, 0, "side-effect import must not be flagged");
  console.log("  ✓ side-effect import not removed");

  const dupA = sampleFinding({ files: ["agora-forge/src/a.tsx"] });
  const dupB = sampleFinding({ files: ["src/a.tsx"] });
  const ctxA = resolveFileContext("agora-forge/src/a.tsx", [
    {
      projectRoot: "/tmp/agora-forge",
      packageName: "agora-forge",
      relativePath: "agora-forge",
      framework: "nextjs",
      runtimeTarget: "mixed",
    },
    {
      projectRoot: "/tmp",
      packageName: "root",
      relativePath: "",
      framework: "nextjs",
      runtimeTarget: "mixed",
    },
  ]);
  const ctxB = resolveFileContext("src/a.tsx", [
    {
      projectRoot: "/tmp/agora-forge",
      packageName: "agora-forge",
      relativePath: "agora-forge",
      framework: "nextjs",
      runtimeTarget: "mixed",
    },
    {
      projectRoot: "/tmp",
      packageName: "root",
      relativePath: "",
      framework: "nextjs",
      runtimeTarget: "mixed",
    },
  ]);
  const dupSemantics = classifyDuplicatePair(dupA, dupB, ctxA, ctxB);
  assert.equal(dupSemantics.sameProject, false);
  assert.equal(dupSemantics.recommendation, "auto_fix_forbidden");
  console.log("  ✓ cross-project duplicates forbidden");

  const reason = formatRejectionReason({
    status: "skipped",
    reason: "Verification introduced new failure in: typecheck",
    comparison: [{ name: "typecheck", outcome: "New regression" }],
    rollbackStatus: "completed",
  });
  assert.match(reason, /rolled back/i);
  console.log("  ✓ rejection reason is specific");

  process.env.PUBLIC_BETA_FREE = "1";
  const ent = checkEntitlement({ toolKey: "quick_cleanup" });
  assert.equal(ent.allowed, true);
  console.log("  ✓ PUBLIC_BETA_FREE enables quick cleanup");

  for (const dir of ["partly-unused-import", "side-effect-import", "nested-workspaces"]) {
    const p = path.join(FIXTURES, dir);
    assert.ok(fs.existsSync(p), `fixture ${dir} exists`);
  }
  console.log("  ✓ fixture directories scaffolded");

  console.log("All correctness fixture tests passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
