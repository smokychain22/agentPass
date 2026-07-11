import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCleanupRunSummary } from "../src/lib/patch-kit/cleanup-summary";
import { computeOperatorPrGates } from "../src/lib/patch-kit/operator-pr-gates";
import { evaluateBackupFileDeletion } from "../src/lib/patch-kit/safe-delete-discovery";
import {
  validateEditsForDelivery,
  validateGeneratedPatchOnly,
} from "../src/lib/patch-kit/validate-patch";
import { runRepositoryVerification } from "../src/lib/patch-kit/repository-verification";
import {
  areRequiredPackagesInstalled,
  ensureVerificationDependencies,
  formatInstallFailureReason,
  inferRequiredPackagesForScripts,
  lockfileWasPatched,
} from "../src/lib/execution/workspace-install";
import { resolveDependencyEntry } from "../src/lib/execution/fix-preflight";
import { applyRepositoryIdentity } from "../src/lib/github/refresh-repo-identity";
import type { FindingsPayload } from "../src/lib/findings/types";
import type { PatchKitSummary } from "../src/lib/patch-kit/types";

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

function sampleFindings(): FindingsPayload {
  return {
    scanId: "scan_test",
    repo: { owner: "velz-cmd", name: "repodiet-e2e-test", branch: "main" },
    summary: {
      totalFindings: 10,
      detectedFindings: 10,
      verifiedFindings: 10,
      duplicateClusters: 1,
      unusedFiles: 1,
      unusedDependencies: 1,
      unusedExports: 0,
      orphanPatterns: 1,
      slopSignals: 0,
      reviewRequired: 3,
      safeCandidates: 2,
      doNotTouch: 2,
      eligibleFindings: 2,
    },
    duplicates: [],
    unused: { files: [], dependencies: [], exports: [] },
    orphans: [],
    slopSignals: [],
    riskBuckets: { safeDelete: [], reviewFirst: ["a.ts"], doNotTouch: ["src/app/page.tsx"] },
    artifacts: { findingsJson: true },
    mode: "live",
    rawToolReports: {
      knip: { status: "ok", source: "knip", sourceMode: "native", durationMs: 1 },
      jscpd: { status: "ok", source: "jscpd", sourceMode: "native", durationMs: 1 },
      madge: { status: "ok", source: "madge", sourceMode: "native", durationMs: 1 },
    },
  };
}

async function run() {
  console.log("E2E pipeline tests");

  await test("patch validation uses git apply only and does not require npm", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-patch-only-"));
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "fixture", scripts: { build: "missing-command" } }, null, 2)
    );
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "index.ts"), "export const x = 1;\n", "utf8");

    const patch = [
      "diff --git a/src/index.ts b/src/index.ts",
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -1 +1 @@",
      "-export const x = 1;",
      "+export const x = 2;",
      "",
    ].join("\n");

    const result = await validateGeneratedPatchOnly(root, patch);
    assert.equal(result.status, "passed", result.error);
    await fs.rm(root, { recursive: true, force: true });
  });

  await test("patch validation is independent from repository verification install step", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-verify-block-"));
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify(
        {
          name: "fixture",
          scripts: { typecheck: "tsc --noEmit", build: "node -e \"\"" },
          devDependencies: { typescript: "^5.8.3" },
        },
        null,
        2
      )
    );
    await fs.writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: { target: "ES2020", module: "ESNext", strict: true, skipLibCheck: true },
          include: ["src"],
        },
        null,
        2
      )
    );
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");

    const edits = [{ path: "src/index.ts", content: "export const value = 2;\n" }];
    const patchResult = await validateEditsForDelivery(root, edits);
    assert.equal(patchResult.status, "passed", patchResult.error);

    const verification = await runRepositoryVerification({
      baselineRoot: root,
      edits,
      cleanupRunId: "test-blocked-install",
    });
    assert.ok(
      verification.checks.some((c) => c.name === "dependency install"),
      "repository verification runs dependency install as a separate stage"
    );
    if (verification.status === "blocked") {
      assert.equal(verification.failureCode, "DEPENDENCY_INSTALL_FAILED");
    }
    await fs.rm(root, { recursive: true, force: true });
  });

  await test("dependency finding without exact package entry is ineligible", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-dep-"));
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "fixture", dependencies: { react: "18.0.0" } }, null, 2)
    );
    await fs.writeFile(path.join(root, "package-lock.json"), "{}\n", "utf8");

    const resolved = await resolveDependencyEntry(root, {
      id: "dep1",
      type: "unused_dependency",
      title: "left-pad",
      files: [],
      packageName: "left-pad",
      confidence: 0.9,
      confidenceReason: "unused",
      severity: "low",
      action: "review_first",
      reason: "unused",
      source: "knip",
      sourceMode: "native",
      evidence: { summary: "unused", signals: [] },
    });

    assert.equal("eligible" in resolved && resolved.eligible === false, true);
    await fs.rm(root, { recursive: true, force: true });
  });

  await test("verification install requires typescript and next binaries", async () => {
    const scripts = { typecheck: "tsc --noEmit", build: "next build" };
    const required = inferRequiredPackagesForScripts(scripts);
    assert.deepEqual(required.sort(), ["next", "typescript"]);

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-verify-install-"));
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify(
        {
          name: "fixture",
          scripts,
          dependencies: { next: "15.5.20", react: "18.3.1", "react-dom": "18.3.1" },
          devDependencies: { typescript: "5.6.3" },
        },
        null,
        2
      )
    );
    await fs.mkdir(path.join(root, "node_modules", "left-pad"), { recursive: true });
    await fs.writeFile(path.join(root, "node_modules", "left-pad", "package.json"), "{}", "utf8");

    assert.equal(await areRequiredPackagesInstalled(root, required), false);

    const install = await ensureVerificationDependencies(root, "verify_test", {
      requiredPackages: required,
    });
    assert.equal(install.installed, true, install.reason);
    assert.equal(await areRequiredPackagesInstalled(root, required), true);
    await fs.rm(root, { recursive: true, force: true });
  });

  await test("repository owner refresh after transfer", () => {
    const findings = sampleFindings();
    findings.repo.owner = "smokychain22";
    findings.repo.name = "repodiet-e2e-test";
    const refreshed = applyRepositoryIdentity(findings, {
      id: 12345,
      owner: "velz-cmd",
      name: "repodiet-e2e-test",
      fullName: "velz-cmd/repodiet-e2e-test",
      defaultBranch: "main",
    });
    assert.equal(refreshed.repo.owner, "velz-cmd");
    assert.equal(refreshed.repo.previousOwner, "smokychain22");
    assert.equal(refreshed.repo.githubRepositoryId, 12345);
  });

  await test("consistent eligibility counts from cleanup run summary", () => {
    const findings = sampleFindings();
    const summary: PatchKitSummary = {
      safeDeleteCandidates: 1,
      transformerCompatible: 2,
      dryRunPassed: 0,
      eligibleFindings: 2,
      attemptedTransformations: 5,
      noopTransformations: 3,
      failedTransformations: 0,
      notAttempted: 0,
      generatedChanges: 2,
      validatedChanges: 2,
      verifiedChanges: 0,
      filesEdited: 1,
      filesDeleted: 1,
      filesAdded: 0,
      rawReviewFindings: 3,
      reviewFirstItems: 3,
      doNotTouchItems: 2,
      packageSuggestions: 1,
      patchLines: 10,
      regressionChecks: 4,
      bundleFileCount: 6,
      patchValidationStatus: "passed",
    };

    const runSummary = buildCleanupRunSummary({
      findings,
      summary,
      candidateAudits: [
        {
          findingId: "1",
          findingType: "unused_import",
          pluginId: "remove_unused_import",
          strategyIds: [],
          sourceFound: true,
          sourceHashMatched: true,
          scanEligible: true,
          transformAttempted: true,
          contentChanged: true,
          dryRunSucceeded: true,
          proposedSourceChanged: true,
          proposedDiffGenerated: true,
          patchValidated: true,
          verificationSupported: true,
          retained: true,
        },
        {
          findingId: "2",
          findingType: "unused_dependency",
          pluginId: "remove_unused_dependency",
          strategyIds: [],
          sourceFound: true,
          sourceHashMatched: true,
          scanEligible: true,
          transformAttempted: true,
          contentChanged: true,
          dryRunSucceeded: true,
          proposedSourceChanged: true,
          proposedDiffGenerated: true,
          patchValidated: true,
          verificationSupported: true,
          retained: true,
        },
        ...Array.from({ length: 3 }, (_, i) => ({
          findingId: `noop-${i}`,
          findingType: "unused_import" as const,
          pluginId: "remove_unused_import" as const,
          strategyIds: [],
          sourceFound: true,
          sourceHashMatched: true,
          scanEligible: true,
          transformAttempted: true,
          contentChanged: false,
          dryRunSucceeded: false,
          proposedSourceChanged: true,
          proposedDiffGenerated: true,
          patchValidated: false,
          verificationSupported: true,
          retained: false,
          blockerCode: "transform_noop" as const,
        })),
      ],
      verification: {
        status: "blocked",
        failureCode: "DEPENDENCY_INSTALL_FAILED",
        installAttempts: [],
        checks: [],
      },
    });

    assert.equal(runSummary.generated, 2);
    assert.equal(runSummary.validated, 2);
    assert.equal(runSummary.verified, 0);
    assert.equal(runSummary.eligible, 2);
    assert.equal(runSummary.executed, 2);
  });

  await test("formatInstallFailureReason strips npm log path noise", () => {
    const reason = formatInstallFailureReason(
      "npm error code EUSAGE\nnpm error `npm ci` can only install packages when your package.json and package-lock.json are in sync\nnpm error A complete log of this run can be found in: /tmp/foo.log",
      ""
    );
    assert.ok(reason.includes("package.json and package-lock.json"));
    assert.ok(!reason.includes("complete log of this run"));
  });

  await test("lockfileWasPatched detects package manifest edits", () => {
    assert.equal(lockfileWasPatched(["package.json", "src/index.ts"]), true);
    assert.equal(lockfileWasPatched(["src/index.ts"]), false);
  });

  await test("verification install prefers npm install when lockfile was patched", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-lock-patch-"));
    const pkg = {
      name: "fixture",
      scripts: { typecheck: "tsc --noEmit" },
      dependencies: { react: "18.3.1" },
      devDependencies: { typescript: "5.6.3" },
    };
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify(pkg, null, 2), "utf8");
    await fs.writeFile(
      path.join(root, "package-lock.json"),
      JSON.stringify(
        {
          name: "fixture",
          lockfileVersion: 3,
          packages: {
            "": { name: "fixture", dependencies: { react: "18.3.1", "left-pad": "1.0.0" } },
          },
        },
        null,
        2
      ),
      "utf8"
    );

    const patchedPkg = {
      name: "fixture",
      scripts: { typecheck: "tsc --noEmit" },
      dependencies: { react: "18.3.1" },
      devDependencies: { typescript: "5.6.3" },
    };
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify(patchedPkg, null, 2), "utf8");

    const install = await ensureVerificationDependencies(root, "lockfile_patch_test", {
      requiredPackages: ["typescript"],
      patchedPaths: ["package.json", "package-lock.json"],
    });
    assert.equal(install.installed, true, install.reason);
    assert.ok(
      install.attempts.some((a) => a.command.startsWith("npm install")),
      "expected npm install attempt when lockfile was patched"
    );
    await fs.rm(root, { recursive: true, force: true });
  });

  await test("backup file deletion proof approves archive backup without imports", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "repodiet-backup-"));
    const rel = "src/archive/OldDashboard.backup.tsx";
    await fs.mkdir(path.join(root, "src", "archive"), { recursive: true });
    await fs.writeFile(
      path.join(root, rel),
      "export function OldDashboard() { return null; }\n",
      "utf8"
    );
    const proof = await evaluateBackupFileDeletion(root, rel, "abc123");
    assert.ok(proof);
    assert.equal(proof.operation, "delete");
    assert.equal(proof.approved, true);
    await fs.rm(root, { recursive: true, force: true });
  });

  await test("PR button disabled with validated > 0 but verified = 0", () => {
    const gates = computeOperatorPrGates({
      locked: false,
      statusLoading: false,
      preflightLoading: false,
      repositoryAuthorized: true,
      permissionsVerified: true,
      canCreateBranch: true,
      canCreatePullRequest: true,
      useDemoAuth: false,
      manualTokenReady: false,
      patchValidated: true,
      generatedChanges: 2,
      validatedChanges: 2,
      verifiedChanges: 0,
      validatedEditCount: 2,
      safeDeleteCount: 1,
      requireVerificationForCleanupPr: true,
      verificationStatus: "blocked",
    });
    assert.equal(gates.canCreateSafePr, false);
  });

  await test("PR gates enable only when verified changes exist", () => {
    const gates = computeOperatorPrGates({
      locked: false,
      statusLoading: false,
      preflightLoading: false,
      repositoryAuthorized: true,
      permissionsVerified: true,
      canCreateBranch: true,
      canCreatePullRequest: true,
      useDemoAuth: false,
      manualTokenReady: false,
      patchValidated: true,
      generatedChanges: 2,
      validatedChanges: 2,
      verifiedChanges: 2,
      validatedEditCount: 2,
      safeDeleteCount: 1,
      requireVerificationForCleanupPr: true,
      verificationStatus: "passed",
    });
    assert.equal(gates.canCreateSafePr, true);
  });

  console.log("All E2E pipeline tests passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
