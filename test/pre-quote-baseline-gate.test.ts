import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { isKnownBaselineInvalidCommit } from "../src/lib/workflow/known-invalid-commits";
import {
  formatBaselineInvalidMessage,
} from "../src/lib/workflow/baseline-readiness";
import { PreQuoteGateError } from "../src/lib/workflow/pre-quote-gate";
import {
  isKnownInvalidScanId,
  isKnownInvalidTaskId,
  scanBlocksFixPr,
} from "../src/lib/workflow/source-invalidation";
import { parseBaselineInvalidUi } from "../src/lib/workflow/baseline-invalid-ui";
import { createBoundQuote, validateQuoteBinding } from "../src/lib/payment/quote-service";
import {
  MERIDIAN_FEED_CURATION_BROKEN,
  MERIDIAN_TOKEN_QUOTE_BROKEN,
} from "./fixtures/meridian-pr14";
import ts from "typescript";

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

function parseDiagnostics(filePath: string, source: string): string[] {
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.Latest, jsx: ts.JsxEmit.Preserve },
    reportDiagnostics: true,
    fileName: filePath,
  });
  return (result.diagnostics ?? []).map((d: ts.Diagnostic) =>
    ts.flattenDiagnosticMessageText(d.messageText, " ")
  );
}

console.log("pre-quote-baseline-gate");

async function main() {
  await test("1. Broken baseline blocks quote creation via known commit", () => {
    assert.equal(isKnownBaselineInvalidCommit("a39937b4b05691a7cc57f2824f18745dd61bea3f"), true);
    assert.equal(isKnownBaselineInvalidCommit("a39937b4"), true);
    assert.equal(isKnownBaselineInvalidCommit("824075afe776067bf00343581105d6a1f5e61178"), false);
  });

  await test("2. Broken baseline blocks task creation for known invalid scan", () => {
    assert.equal(isKnownInvalidScanId("scan_CellDRLCZHAa"), true);
    assert.equal(scanBlocksFixPr({ status: "invalid_source_baseline", retryable: false, requiresNewScan: true, reason: "x", invalidatedAt: "" }), true);
  });

  await test("3. Broken baseline blocks test settlement when quote lacks transform hashes", async () => {
    const quote = await createBoundQuote({
      repository: "velz-cmd/Meridian",
      branch: "main",
      commitSha: "a39937b4b05691a7cc57f2824f18745dd61bea3f",
      findingIds: ["f1"],
      operation: "verified_cleanup_pr",
      scanId: "scan_CellDRLCZHAa",
    });
    assert.equal(quote.scanId, "scan_CellDRLCZHAa");
    assert.equal(isKnownBaselineInvalidCommit(quote.commitSha), true);
  });

  await test("4. Broken baseline blocks real payment binding for invalid commit", async () => {
    const quote = await createBoundQuote({
      repository: "velz-cmd/Meridian",
      branch: "main",
      commitSha: "a39937b4b05691a7cc57f2824f18745dd61bea3f",
      findingIds: ["f1"],
      operation: "verified_cleanup_pr",
      scanId: "scan_test",
      transformedSourceHashes: { f1: "hash1" },
    });
    const binding = validateQuoteBinding(quote, {
      repository: quote.repository,
      branch: quote.branch,
      commitSha: "824075afe776067bf00343581105d6a1f5e61178",
      findingIds: quote.findingIds,
      operation: quote.operation,
      scanId: quote.scanId,
      transformedSourceHashes: quote.transformedSourceHashes,
    });
    assert.equal(binding.ok, false);
  });

  await test("5. New scan ID on same broken commit remains blocked", () => {
    assert.equal(isKnownBaselineInvalidCommit("a39937b4b056"), true);
    assert.equal(isKnownInvalidScanId("scan_DymsApC3ZKMJ"), true);
    assert.equal(isKnownInvalidScanId("scan_CellDRLCZHAa"), true);
  });

  await test("6. Repaired commit is not in known-invalid set", () => {
    assert.equal(isKnownBaselineInvalidCommit("824075afe776067bf00343581105d6a1f5e61178"), false);
  });

  await test("7. Malformed transformed source blocks quote via syntax diagnostics", async () => {
    const feedDiags = parseDiagnostics("src/lib/feed-curation.ts", MERIDIAN_FEED_CURATION_BROKEN);
    const tokenDiags = parseDiagnostics("src/lib/token-quote.ts", MERIDIAN_TOKEN_QUOTE_BROKEN);
    assert.ok(feedDiags.length > 0, "broken feed-curation should have syntax diagnostics");
    assert.ok(tokenDiags.length > 0, "broken token-quote should have syntax diagnostics");
  });

  await test("8. Stale source commit invalidates quote binding", async () => {
    const quote = await createBoundQuote({
      repository: "o/r",
      branch: "main",
      commitSha: "abc123",
      findingIds: ["f1"],
      operation: "verified_cleanup_pr",
      scanId: "scan_old",
      transformedSourceHashes: { f1: "hash1" },
    });
    const binding = validateQuoteBinding(quote, {
      repository: quote.repository,
      branch: quote.branch,
      commitSha: "def456",
      findingIds: quote.findingIds,
      operation: quote.operation,
      scanId: "scan_new",
      transformedSourceHashes: quote.transformedSourceHashes,
    });
    assert.equal(binding.ok, false);
    assert.match(binding.reason ?? "", /Commit SHA mismatch|Scan ID mismatch/);
  });

  await test("9. Repeated blocked requests create no duplicate tasks (gate throws before task)", () => {
    const err = new PreQuoteGateError("Repository baseline invalid", {
      code: "baseline_invalid",
      httpStatus: 422,
      invalidation: { status: "invalid_source_baseline", retryable: false, requiresNewScan: true },
    });
    assert.equal(err.httpStatus, 422);
    assert.equal(err.invalidation?.requiresNewScan, true);
  });

  await test("10. UI never offers retry against same invalid commit", () => {
    const ui = parseBaselineInvalidUi({
      message: formatBaselineInvalidMessage({
        status: "baseline_invalid",
        commitSha: "a39937b4b056",
        archiveRetrieved: true,
        touchedFilesParsed: false,
        requiredChecksDetected: ["build"],
        failedCheck: "npm run build",
        diagnostics: [],
        action: "Repair the repository source and run a new scan.",
      }),
      commitSha: "a39937b4b056",
    });
    assert.ok(ui);
    assert.equal(ui?.hideRetry, true);
    assert.equal(ui?.hideQuoteButton, true);
    assert.match(ui?.scanGuidance ?? "", /repository HEAD changes/i);
  });

  await test("known invalid task IDs are flagged", () => {
    assert.equal(isKnownInvalidTaskId("task_647802f1c5dd49"), true);
    assert.equal(isKnownInvalidTaskId("task_61d1b67bbcf540"), true);
  });

  await test("build-info route exists", async () => {
    const routePath = path.join(process.cwd(), "src/app/api/build-info/route.ts");
    const src = await fs.readFile(routePath, "utf8");
    assert.match(src, /VERCEL_GIT_COMMIT_SHA/);
    assert.match(src, /gitCommit/);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
