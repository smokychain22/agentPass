import assert from "node:assert/strict";
import path from "node:path";
import { enrichExactDuplicateFindings } from "../src/lib/findings/enrich-exact-duplicates";
import { runFindingsEngine } from "../src/lib/findings/findings-engine";
import { runPatchKitEngine } from "../src/lib/patch-kit/patch-kit-engine";
import { runVerification } from "../src/lib/verify/run-verification";
import { patchHasApplyableOperations } from "../src/lib/patch-kit/validate-patch";
import {
  listAutomaticTransformers,
  getTransformerDefinition,
} from "../src/lib/execution/transformer-registry";

const E2E_REPO_URL = "https://github.com/smokychain22/repodiet-e2e-test";

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      throw err;
    });
}

async function main() {
  const fixturePath = path.join(process.cwd(), "e2e-fixture");
  process.env.REPODIET_E2E_FIXTURE_PATH = fixturePath;

  console.log("E2E fixture integration test (repair engine)");
  console.log(`  fixture: ${fixturePath}`);

  await test("transformer registry lists automatic repair actions", () => {
    const automatic = listAutomaticTransformers();
    assert.ok(automatic.some((t) => t.id === "remove_unused_import"));
    assert.ok(automatic.some((t) => t.id === "consolidate_exact_duplicate"));
    assert.equal(getTransformerDefinition("review_only")?.automatic, false);
  });

  let findings;
  await test("findings engine completes with exact duplicate enrichment", async () => {
    findings = await runFindingsEngine(E2E_REPO_URL, "main");
    const exactDup = findings.duplicates.filter((f) =>
      f.evidence.signals.some((s) => s === "exact_file_duplicate=true")
    );
    assert.ok(exactDup.length >= 1, "Expected exact duplicate finding");
    const emptyFile = findings.unused.files.find((f) =>
      f.evidence.signals.some((s) => s === "empty_file=true")
    );
    assert.ok(emptyFile, "Expected empty file finding");
  });

  let patchKit;
  await test("Quick Cleanup generates validated source changes", async () => {
    patchKit = await runPatchKitEngine({
      repoUrl: E2E_REPO_URL,
      branch: "main",
      findings: findings!,
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
  });

  await test("retained edit removes Clock from Dashboard import", () => {
    const dashboardEdit = patchKit!.validatedEdits?.find((e) => e.path.includes("Dashboard.tsx"));
    assert.ok(dashboardEdit, "Expected Dashboard.tsx validated edit");
    assert.doesNotMatch(dashboardEdit!.content, /\bClock\b/);
    assert.match(dashboardEdit!.content, /CheckCircle/);
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
