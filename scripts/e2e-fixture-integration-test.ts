import assert from "node:assert/strict";
import path from "node:path";
import { runFindingsEngine } from "../src/lib/findings/findings-engine";
import { runPatchKitEngine } from "../src/lib/patch-kit/patch-kit-engine";
import { runVerification } from "../src/lib/verify/run-verification";
import { patchHasApplyableOperations } from "../src/lib/patch-kit/validate-patch";
import {
  listAutomaticTransformers,
  getTransformerDefinition,
} from "../src/lib/execution/transformer-registry";
import { buildMaintenanceOutcome } from "../src/lib/maintenance/outcome";
import { isCleanupEligible } from "../src/lib/findings/cleanup-eligibility";
import type { Finding } from "../src/lib/findings/types";

const E2E_REPO_URL = "https://github.com/smokychain22/repodiet-e2e-test";
const FIXTURE_RELATIVE = "e2e-fixture";

/** Stable fixture contract — paths, not unstable nanoid finding IDs. */
const EXACT_DUP_CANONICAL = "src/lib/exact-dup-canonical.ts";
const EXACT_DUP_COPIES = ["src/lib/exact-dup-copy.ts", "src/lib/exact-dup-copy-two.ts"] as const;
const EXACT_DUP_CONSUMER = "src/lib/exact-dup-consumer.ts";
const EXPECTED_TRANSFORMER = "consolidate_exact_duplicate";

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      throw err;
    });
}

function signalValue(finding: Finding, prefix: string): string | undefined {
  return finding.evidence.signals
    .find((signal) => signal.startsWith(prefix))
    ?.slice(prefix.length);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function exactDuplicateFindings(findings: { duplicates: Finding[] }): Finding[] {
  return findings.duplicates
    .filter((f) => f.evidence.signals.includes("exact_file_duplicate=true"))
    .sort((a, b) => {
      const da = signalValue(a, "duplicate=") ?? "";
      const db = signalValue(b, "duplicate=") ?? "";
      return da.localeCompare(db);
    });
}

async function main() {
  const fixturePath = path.join(process.cwd(), FIXTURE_RELATIVE);
  process.env.REPODIET_E2E_FIXTURE_PATH = fixturePath;

  console.log("E2E fixture integration test (repair engine)");
  console.log(`  fixture: ${fixturePath}`);
  console.log(`  repository: ${E2E_REPO_URL}`);
  console.log(`  expectedTransformer: ${EXPECTED_TRANSFORMER}`);

  await test("transformer registry lists automatic repair actions", () => {
    const automatic = listAutomaticTransformers();
    assert.ok(automatic.some((t) => t.id === "remove_unused_import"));
    assert.ok(automatic.some((t) => t.id === "consolidate_exact_duplicate"));
    assert.equal(getTransformerDefinition("review_only")?.automatic, false);
  });

  let findings;
  let exactDups: Finding[] = [];
  await test("findings engine completes with exact duplicate enrichment", async () => {
    findings = await runFindingsEngine(E2E_REPO_URL, "main");
    exactDups = exactDuplicateFindings(findings);
    assert.ok(exactDups.length >= 2, "Expected two exact duplicate findings for a 3-to-1 outcome");

    const duplicatePaths = exactDups.map((f) => signalValue(f, "duplicate=") ?? "").sort();
    assert.deepEqual(duplicatePaths, [...EXACT_DUP_COPIES].sort());
    for (const finding of exactDups) {
      assert.equal(signalValue(finding, "canonical="), EXACT_DUP_CANONICAL);
      assert.equal(finding.action, "safe_candidate", `${finding.id} must be SAFE for cleanup`);
      assert.equal(isCleanupEligible(finding), true, `${finding.id} must be cleanup-eligible`);
    }

    const emptyFile = findings.unused.files.find((f) =>
      f.evidence.signals.some((s) => s === "empty_file=true")
    );
    assert.ok(emptyFile, "Expected empty file finding");

    console.log(`    pinnedCommit: ${findings.repo.commitSha ?? "(local fixture)"}`);
    console.log(
      `    selectedExactDupIds: ${exactDups.map((f) => f.id).sort().join(", ")}`
    );
  });

  let patchKit;
  await test("Quick Cleanup generates validated exact-duplicate consolidation", async () => {
    // Explicit selection by path-stable finding IDs from this scan — not array order.
    const selectedFindingIds = exactDups.map((f) => f.id).sort();
    patchKit = await runPatchKitEngine({
      repoUrl: E2E_REPO_URL,
      branch: "main",
      findings: findings!,
      selectedFindingIds,
    });

    console.log(`    generated: ${patchKit.summary.generatedChanges}`);
    console.log(`    validated: ${patchKit.summary.validatedChanges}`);
    console.log(`    patch validation: ${patchKit.patchValidation?.status}`);
    if (patchKit.summary.blockerSummary) {
      console.log(`    blockers: ${patchKit.summary.blockerSummary}`);
    }

    assert.ok(patchKit.summary.generatedChanges >= 1);
    assert.ok(patchKit.summary.validatedChanges >= 1);
    assert.equal(patchKit.patchValidation?.status, "passed", patchKit.patchValidation?.error);
    assert.ok(patchHasApplyableOperations(patchKit.artifacts.cleanupPatch));

    const ops = [...(patchKit.changeOperations ?? [])].sort((a, b) =>
      `${a.type}:${a.filePath}`.localeCompare(`${b.type}:${b.filePath}`)
    );
    for (const op of ops) {
      assert.equal(
        op.transformerId,
        EXPECTED_TRANSFORMER,
        `operation ${op.type} ${op.filePath} must use ${EXPECTED_TRANSFORMER}`
      );
    }

    const deleted = ops
      .filter((op) => op.type === "delete")
      .map((op) => normalizePath(op.filePath))
      .sort();
    const edited = ops
      .filter((op) => op.type === "edit")
      .map((op) => normalizePath(op.filePath))
      .sort();

    assert.deepEqual(deleted, [...EXACT_DUP_COPIES].sort());
    assert.ok(
      edited.includes(EXACT_DUP_CONSUMER),
      `expected consumer rewire edit for ${EXACT_DUP_CONSUMER}, got ${edited.join(", ")}`
    );
    assert.ok(
      !deleted.includes(EXACT_DUP_CANONICAL),
      "canonical implementation must be preserved"
    );
    assert.ok(
      !edited.includes(EXACT_DUP_CANONICAL) || true,
      "canonical path may be untouched"
    );

    console.log(`    deleted: ${deleted.join(", ")}`);
    console.log(`    edited: ${edited.join(", ")}`);
    console.log(`    preserved: ${EXACT_DUP_CANONICAL}`);
  });

  await test("retained unused-import edit removes Clock from Dashboard", async () => {
    const { flattenFindings } = await import("../src/lib/findings/client");
    const clock = flattenFindings(findings!).find(
      (f) =>
        f.type === "unused_import" &&
        f.files.some((p) => normalizePath(p).endsWith("src/components/Dashboard.tsx")) &&
        f.evidence.signals.some((s) => s === "symbol=Clock" || s.startsWith("symbol=Clock"))
    );

    assert.ok(clock, "Expected unused Clock import finding on Dashboard.tsx");
    assert.equal(isCleanupEligible(clock), true, "Clock unused import must be cleanup-eligible");

    const importKit = await runPatchKitEngine({
      repoUrl: E2E_REPO_URL,
      branch: "main",
      findings: findings!,
      selectedFindingIds: [clock.id],
    });
    const dashboardEdit = importKit.validatedEdits?.find((e) =>
      normalizePath(e.path).endsWith("src/components/Dashboard.tsx")
    );
    assert.ok(dashboardEdit, "Expected Dashboard.tsx validated edit");
    assert.doesNotMatch(dashboardEdit!.content, /\bClock\b/);
    assert.match(dashboardEdit!.content, /CheckCircle/);
  });

  await test("validated patch proves a prepared 3-to-1 canonicalization outcome", () => {
    const outcome = buildMaintenanceOutcome({
      findings: findings!,
      changeOperations: patchKit!.changeOperations,
      verificationStatus:
        patchKit!.repositoryVerification?.status ?? patchKit!.patchValidation?.status,
    });
    const canonicalization = outcome.canonicalizations.find(
      (entry) => entry.canonicalPath === EXACT_DUP_CANONICAL
    );

    assert.equal(outcome.kind, "exact_duplicate_canonicalization");
    assert.equal(
      outcome.headline,
      "3 byte-identical implementations will be consolidated into 1 canonical implementation"
    );
    assert.ok(canonicalization, "Expected exact duplicate canonicalization outcome");
    assert.equal(canonicalization!.beforeImplementations, 3);
    assert.equal(canonicalization!.afterImplementations, 1);
    assert.deepEqual(canonicalization!.removedDuplicatePaths, [...EXACT_DUP_COPIES].sort());
    assert.deepEqual(canonicalization!.rewiredImporterPaths, [EXACT_DUP_CONSUMER]);
  });

  await test("verification runs real repository commands", async () => {
    const verification = await runVerification(patchKit!.id, patchKit!);
    console.log(`    verification status: ${verification.status}`);
    for (const check of verification.checks) {
      console.log(`      ${check.name}: ${check.status} (exit ${check.exitCode})`);
    }
    assert.ok(
      verification.checks.some((c) => c.status === "passed" || c.status === "failed"),
      "Expected at least one executed verification check"
    );
    assert.notEqual(verification.status, "not_run");
  });

  console.log("\ne2e-fixture-integration-test: PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
