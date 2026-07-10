/**
 * End-to-end integration test: scan → findings → Quick Cleanup on e2e-fixture.
 * Uses local e2e-fixture copy (no GitHub fetch required).
 *
 * Run: npx tsx scripts/e2e-fixture-integration-test.ts
 */
import assert from "node:assert/strict";
import path from "node:path";
import { runFindingsEngine } from "../src/lib/findings/findings-engine";
import { runPatchKitEngine } from "../src/lib/patch-kit/patch-kit-engine";
import { flattenFindings } from "../src/lib/findings/client";
import {
  isTransformerCompatible,
  isDryRunPassed,
  isActionableFinding,
} from "../src/lib/findings/actionability-signals";
import { patchHasApplyableOperations } from "../src/lib/patch-kit/validate-patch";

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

  console.log("E2E fixture integration test");
  console.log(`  fixture: ${fixturePath}`);

  let findings;
  await test("findings engine completes on e2e-fixture", async () => {
    findings = await runFindingsEngine(E2E_REPO_URL, "main");
    assert.ok(findings.scanId);
    assert.equal(findings.repo.name, "repodiet-e2e-test");
  });

  const flat = flattenFindings(findings!);
  const clockImport = flat.find(
    (f) =>
      f.type === "unused_import" &&
      f.files.some((p) => p.includes("Dashboard.tsx")) &&
      f.evidence.signals.some((s) => s.includes("Clock"))
  );

  await test("detects unused Clock import in Dashboard.tsx", () => {
    assert.ok(clockImport, "Expected unused Clock import finding");
    assert.equal(isTransformerCompatible(clockImport!), true);
  });

  await test("Clock import passes dry-run preflight at scan time", () => {
    assert.ok(isDryRunPassed(clockImport!), "Clock import should pass dry-run preflight");
    assert.equal(isActionableFinding(clockImport!), true);
  });

  const backupFinding = flat.find(
    (f) =>
      (f.type === "unused_file" || f.type === "ai_slop_signal") &&
      f.files.some((p) => p.includes("OldDashboard.backup"))
  );
  await test("detects backup file candidate", () => {
    assert.ok(backupFinding, "Expected backup file finding");
  });

  let patchKit;
  await test("Quick Cleanup generates validated changes", async () => {
    patchKit = await runPatchKitEngine({
      repoUrl: E2E_REPO_URL,
      branch: "main",
      findings: findings!,
    });

    console.log(`    transformer-compatible: ${patchKit.summary.transformerCompatible}`);
    console.log(`    dry-run passed: ${patchKit.summary.dryRunPassed}`);
    console.log(`    generated: ${patchKit.summary.generatedChanges}`);
    console.log(`    validated: ${patchKit.summary.validatedChanges}`);
    console.log(`    verified: ${patchKit.summary.verifiedChanges}`);
    console.log(`    patch validation: ${patchKit.patchValidation?.status}`);
    if (patchKit.summary.blockerSummary) {
      console.log(`    blockers: ${patchKit.summary.blockerSummary}`);
    }

    assert.ok(
      patchKit.summary.validatedChanges >= 1,
      `Expected >= 1 validated change, got ${patchKit.summary.validatedChanges}`
    );
    if (patchKit.patchValidation?.status !== "passed") {
      const { writeFileSync } = await import("node:fs");
      writeFileSync("/tmp/repodiet-e2e-patch.diff", patchKit.artifacts.cleanupPatch);
      console.log("    patch written to /tmp/repodiet-e2e-patch.diff");
    }
    assert.equal(patchKit.patchValidation?.status, "passed", patchKit.patchValidation?.error);
    assert.ok(patchHasApplyableOperations(patchKit.artifacts.cleanupPatch));
  });

  await test("retained edit removes Clock from Dashboard import", () => {
    const dashboardEdit = patchKit!.validatedEdits?.find((e) =>
      e.path.includes("Dashboard.tsx")
    );
    assert.ok(dashboardEdit, "Expected Dashboard.tsx validated edit");
    assert.doesNotMatch(dashboardEdit!.content, /\bClock\b/);
    assert.match(dashboardEdit!.content, /CheckCircle/);
  });

  await test("cleanup patch includes non-empty unified diff", () => {
    assert.match(patchKit!.artifacts.cleanupPatch, /diff --git/);
  });

  await test("candidate audit table has explicit blockers not generic skip", () => {
    const audits = patchKit!.candidateAudits ?? [];
    assert.ok(audits.length > 0);
    const retained = audits.filter((a) => a.retained);
    assert.ok(retained.length >= 1, "Expected at least one retained audit");
    for (const audit of audits) {
      if (!audit.retained && audit.blockerCode) {
        assert.notEqual(audit.blockerCode, "skipped");
      }
    }
  });

  console.log("\ne2e-fixture-integration-test: PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
