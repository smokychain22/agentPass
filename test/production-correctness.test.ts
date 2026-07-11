import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  FREE_CANDIDATE_ATTEMPT_LIMIT,
  FREE_RETAINED_FIX_LIMIT,
  MAX_STRATEGIES_PER_FINDING,
} from "../src/lib/execution/constants";
import {
  removeUnusedSymbolFromImport,
  detectUnusedImportsInSource,
} from "../src/lib/findings/unused-import-detector";
import { hashSource, validateTransformInvariants } from "../src/lib/execution/transform-audit";
import { dryRunPhase1Fix, runFixPreflight } from "../src/lib/execution/fix-preflight";
import {
  attemptConsumesCandidateLimit,
  assertNoGenericSkippedLabel,
  deriveAttemptProductOutcome,
  PRODUCT_OUTCOME_LABELS,
} from "../src/lib/execution/outcomes";
import type { Finding } from "../src/lib/findings/types";

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ ${name}`);
      throw err;
    }
  })();
}

function executionStepFinding(): Finding {
  return {
    id: "f-exec-step",
    type: "unused_import",
    title: "Unused import: ExecutionStep",
    files: ["agora-forge/src/lib/execution/orchestrator.ts"],
    confidence: 0.9,
    confidenceReason: "heuristic",
    severity: "low",
    action: "safe_candidate",
    reason: "ExecutionStep unused",
    source: "heuristic",
    sourceMode: "heuristic",
    evidence: {
      summary: "unused ExecutionStep",
      signals: [
        "symbol=ExecutionStep",
        'importLine=import type { ExecutionJob, ExecutionStep } from "@/lib/execution/types";',
      ],
    },
  };
}

async function run() {
  console.log("Production correctness tests");

  await test("ExecutionStep: preserve ExecutionJob in type-only import", () => {
    const before = `import type { ExecutionJob, ExecutionStep } from "./types";\n\nexport function run(job: ExecutionJob) {\n  return job.id;\n}\n`;
    const importLine = 'import type { ExecutionJob, ExecutionStep } from "./types";';
    const after = removeUnusedSymbolFromImport(before, importLine, "ExecutionStep");
    assert.match(after, /import type \{ ExecutionJob \} from "\.\/types"/);
    assert.doesNotMatch(after, /ExecutionStep/);
    assert.match(after, /ExecutionJob/);
    assert.notEqual(hashSource(before), hashSource(after));
  });

  await test("ExecutionStep: non-empty diff stats from transform", () => {
    const before = `import type { ExecutionJob, ExecutionStep } from "./types";\nexport const x = (j: ExecutionJob) => j;\n`;
    const after = removeUnusedSymbolFromImport(
      before,
      'import type { ExecutionJob, ExecutionStep } from "./types";',
      "ExecutionStep"
    );
    const diff = [
      "diff --git a/orchestrator.ts b/orchestrator.ts",
      "--- a/orchestrator.ts",
      "+++ b/orchestrator.ts",
      `-import type { ExecutionJob, ExecutionStep } from "./types";`,
      `+import type { ExecutionJob } from "./types";`,
    ].join("\n");
    const result = validateTransformInvariants({
      originalSource: before,
      transformedSource: after,
      unifiedDiff: diff,
      changedFiles: ["orchestrator.ts"],
      findingPath: "orchestrator.ts",
      workspacePathInsideRoot: true,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.record.additions + result.record.deletions > 0);
    }
  });

  await test("JSX-used import Play is not flagged unused", () => {
    const source = `import { Clock, Play } from "lucide-react";\n\nexport function X() { return <Play />; }\n`;
    const found = detectUnusedImportsInSource("src/x.tsx", source);
    assert.ok(!found.some((f) => f.symbol === "Play"));
  });

  await test("side-effect import is never removed", () => {
    const source = `import "polyfill";\nconsole.log("x");\n`;
    assert.equal(detectUnusedImportsInSource("src/y.ts", source).length, 0);
  });

  await test("dry-run noop cannot classify as actionable", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-pc-"));
    const rel = "src/a.ts";
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    const source = `import { Used } from "./b";\nexport const v = Used;\n`;
    await fs.writeFile(path.join(root, rel), source);
    const finding: Finding = {
      ...executionStepFinding(),
      id: "noop",
      files: [rel],
      evidence: {
        summary: "invalid",
        signals: ["symbol=Missing", 'importLine=import { Used } from "./b";'],
      },
    };
    const preflight = await runFixPreflight(root, finding);
    assert.notEqual(preflight.classification, "actionable_candidate");
    await fs.rm(root, { recursive: true, force: true });
  });

  await test("dry-run produces actionable candidate for ExecutionStep fixture", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-pc-"));
    const rel = "agora-forge/src/lib/execution/orchestrator.ts";
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    const source = `import type { ExecutionJob, ExecutionStep } from "@/lib/execution/types";\n\nexport function orchestrate(job: ExecutionJob) {\n  return job;\n}\n`;
    await fs.writeFile(path.join(root, rel), source);
    const finding = executionStepFinding();
    const change = await dryRunPhase1Fix(root, finding, "remove_unused_named_specifier");
    assert.ok(change);
    assert.notEqual(change!.originalHash, change!.modifiedHash);
    assert.ok(change!.unifiedDiff.length > 0);
    assert.ok(change!.additions + change!.deletions > 0);
    const preflight = await runFixPreflight(root, finding);
    assert.equal(preflight.classification, "actionable_candidate");
    await fs.rm(root, { recursive: true, force: true });
  });

  await test("transform_noop does not consume candidate attempt budget", () => {
    assert.equal(attemptConsumesCandidateLimit("transform_noop"), false);
    assert.equal(attemptConsumesCandidateLimit("infrastructure_failed"), false);
    assert.equal(attemptConsumesCandidateLimit("rolled_back_regression"), true);
  });

  await test("deriveAttemptProductOutcome maps transform_noop", () => {
    const outcome = deriveAttemptProductOutcome({
      internalStatus: "skipped",
      reason: "transform_noop: No diff was generated for this fix.",
      pluginId: "remove_unused_import",
    });
    assert.equal(outcome, "transform_noop");
  });

  await test("limits: 1 retained, 5 candidates, 3 strategies per finding", () => {
    assert.equal(FREE_RETAINED_FIX_LIMIT, 1);
    assert.equal(FREE_CANDIDATE_ATTEMPT_LIMIT, 5);
    assert.equal(MAX_STRATEGIES_PER_FINDING, 3);
  });

  await test("generic Skipped absent from product outcome labels", () => {
    for (const label of Object.values(PRODUCT_OUTCOME_LABELS)) {
      assert.equal(assertNoGenericSkippedLabel(label), true, `label failed: ${label}`);
    }
  });

  console.log("All production correctness tests passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
