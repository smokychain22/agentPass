import assert from "node:assert/strict";

/**
 * Regression for a production defect caught live 2026-08-14 proving the
 * GitHub Actions sandbox worker end to end: a fully-verified patch kit
 * (`patchValidation.status: "passed"`, `summary.verifiedChanges: 1`, both
 * confirmed via `/api/patch-kit/status/[id]`) was refused by
 * `POST /api/github/create-cleanup-pr` with "No verified source changes in
 * cleanup run." — reading the SAME record, moments later.
 *
 * Root cause: `getStoredPatchKit` read-through an in-memory `Map` on
 * `globalThis`, populated on write and never invalidated. That map is
 * per serverless instance. The sandbox worker's async completion callback
 * (a request handled by a DIFFERENT instance) wrote the passing result to
 * durable storage; an instance that had already cached this patch kit at
 * its earlier `pending_sandbox` state kept returning that stale copy
 * forever, with no way to know a newer version existed elsewhere. `/status`
 * only happened to read correctly because it also calls
 * `reconcileSandboxRun`, which re-persists (and thus refreshes that one
 * instance's cache) immediately before its own read — an accidental fix,
 * not a real one, since a delivery attempt on a DIFFERENT stale instance
 * would still fail.
 *
 * This test cannot spawn a second serverless instance, but it pins the
 * property that actually matters: a write from ANY caller — modelled here
 * as "a second, independent write to the same id" — must be visible to
 * every subsequent read, unconditionally. Before the fix, the cached copy
 * from the first write would have shadowed the second write's result.
 */

process.env.UPSTASH_REDIS_REST_URL = "";
process.env.UPSTASH_REDIS_REST_TOKEN = "";

import { getStoredPatchKit, storePatchKit } from "../src/lib/patch-kit/patch-kit-store";
import type { PatchKitPayload } from "../src/lib/patch-kit/types";

function test(name: string, fn: () => Promise<void>) {
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

function fixturePayload(id: string, verifiedChanges: number, status: "pending_sandbox" | "passed"): PatchKitPayload {
  return {
    id,
    repo: { owner: "velz-cmd", name: "repodiet-e2e-test", branch: "main" },
    summary: {
      safeDeleteCandidates: 0,
      transformerCompatible: 1,
      dryRunPassed: 1,
      generatedChanges: 1,
      validatedChanges: verifiedChanges,
      verifiedChanges,
      filesEdited: 0,
      filesDeleted: verifiedChanges,
      filesAdded: 0,
      rawReviewFindings: 0,
      reviewFirstItems: 0,
      doNotTouchItems: 0,
      packageSuggestions: 0,
      patchLines: 4,
      regressionChecks: 0,
      bundleFileCount: 1,
      patchValidationStatus: status,
    },
    patchValidation: { status },
    artifacts: {
      reportMd: "report",
      cleanupPatch: "patch",
      packageCleanupMd: "pkg",
      regressionChecklistMd: "checklist",
      cursorPromptMd: "prompt",
      findingsJson: { summary: {}, riskBuckets: { reviewFirst: [], doNotTouch: [], safeDelete: [] } } as never,
      patchkitSummaryJson: "{}",
    },
    downloadUrl: "/download",
  };
}

console.log("patch-kit-store multi-instance consistency");

async function main() {
  await test("THE BUG: a second write to the same id is immediately visible to the next read — never a stale copy", async () => {
    const id = `patchkit_consistency_${Date.now()}`;

    // First write: the state a caller would have seen and (pre-fix) cached
    // right after /api/patch-kit/generate returns, before sandbox validation
    // has run — patchValidation.status = "pending_sandbox", verifiedChanges = 0.
    await storePatchKit(fixturePayload(id, 0, "pending_sandbox"), Buffer.from("zip-1"), "kit.zip");

    const firstRead = await getStoredPatchKit(id);
    assert.equal(firstRead?.payload.summary.verifiedChanges, 0);
    assert.equal(firstRead?.payload.patchValidation?.status, "pending_sandbox");

    // Second write: models the sandbox worker's async completion callback —
    // a genuinely separate request/process, writing the passing result.
    await storePatchKit(fixturePayload(id, 1, "passed"), Buffer.from("zip-2"), "kit.zip");

    // The delivery route's read, immediately after. Before the fix, a
    // process that had already read (and cached) the first write would
    // return it again here — exactly the "verifiedChanges: 0" the real
    // create-cleanup-pr call saw despite the sandbox worker having already
    // reported "passed".
    const secondRead = await getStoredPatchKit(id);
    assert.equal(
      secondRead?.payload.summary.verifiedChanges,
      1,
      "a later write must be visible to the very next read — no stale cached copy"
    );
    assert.equal(secondRead?.payload.patchValidation?.status, "passed");
  });

  await test("a read for an id that was never written returns undefined, not a crash", async () => {
    const missing = await getStoredPatchKit(`patchkit_never_written_${Date.now()}`);
    assert.equal(missing, undefined);
  });

  await test("repeated reads of an unchanged record are stable", async () => {
    const id = `patchkit_stable_${Date.now()}`;
    await storePatchKit(fixturePayload(id, 3, "passed"), Buffer.from("zip"), "kit.zip");
    const a = await getStoredPatchKit(id);
    const b = await getStoredPatchKit(id);
    assert.equal(a?.payload.summary.verifiedChanges, 3);
    assert.equal(b?.payload.summary.verifiedChanges, 3);
  });

  console.log("patch-kit-store multi-instance consistency: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
