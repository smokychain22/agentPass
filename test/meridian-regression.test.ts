import assert from "node:assert/strict";
import type { Finding } from "../src/lib/findings/types";
import { parseUnusedImportEvidence } from "../src/lib/execution/unused-import-evidence";
import { removeUnusedImportSpecifierAst } from "../src/lib/execution/unused-import-ast";
import { validateTransformedSourceSyntax } from "../src/lib/execution/validate-transform-syntax";
import { runFixPreflight } from "../src/lib/execution/fix-preflight";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  MERIDIAN_FEED_CURATION_BROKEN,
  MERIDIAN_FEED_CURATION_GOOD,
  MERIDIAN_TOKEN_QUOTE_BROKEN,
  MERIDIAN_TOKEN_QUOTE_GOOD,
} from "./fixtures/meridian-pr14";

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

function unusedImportFinding(signals: string[], file = "src/example.ts"): Finding {
  return {
    id: "f1",
    type: "unused_import",
    action: "safe_candidate",
    confidence: 0.9,
    reason: "unused",
    files: [file],
    source: "knip",
    sourceMode: "native",
    evidence: { summary: "knip unused import", signals },
  } as Finding;
}

console.log("meridian-regression");

async function main() {
await test("Test 1: unused-import transform must not alter BLUE_CHIP declarations", () => {
  const source = MERIDIAN_FEED_CURATION_GOOD;
  const finding = unusedImportFinding(
    [
      "importLine=import type { TrendingToken } from \"./dexscreener\";",
      "symbol=TrendingToken",
    ],
    "src/lib/feed-curation.ts"
  );
  const evidence = parseUnusedImportEvidence(finding);
  assert.equal(evidence.ok, true);
  if (!evidence.ok) return;
  const modified = removeUnusedImportSpecifierAst(source, evidence.evidence);
  if (modified) {
    assert.ok(source.includes("BLUE_CHIP_SYMBOLS"));
    assert.ok(modified.includes("BLUE_CHIP_SYMBOLS"));
    assert.ok(modified.includes("BLUE_CHIP_NAME_HINTS"));
  }
});

await test("Test 2: unused-import transform must not remove isTokenQuoteReliable", () => {
  const source = MERIDIAN_TOKEN_QUOTE_GOOD;
  const finding = unusedImportFinding(
    [
      "importLine=import { foo } from \"bar\";",
      "symbol=foo",
    ],
    "src/lib/token-quote.ts"
  );
  const evidence = parseUnusedImportEvidence(finding);
  assert.equal(evidence.ok, true);
  if (!evidence.ok) return;
  const modified = removeUnusedImportSpecifierAst(source, evidence.evidence);
  assert.equal(modified, null);
  assert.match(source, /export function isTokenQuoteReliable/);
});

await test("Test 3: malformed importLine evidence returns invalid_transform_evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meridian-preflight-"));
  try {
    const rel = "src/lib/feed-curation.ts";
    await fs.mkdir(path.join(root, "src/lib"), { recursive: true });
    await fs.writeFile(path.join(root, rel), MERIDIAN_FEED_CURATION_GOOD, "utf8");
    const finding = unusedImportFinding(
      ["importLine=const BLUE_CHIP_NAME_HINTS = [", "symbol=unused"],
      rel
    );
    const preflight = await runFixPreflight(root, finding);
    assert.equal(preflight.blockerCode, "invalid_transform_evidence");
    assert.equal(preflight.classification, "detected_candidate");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

await test("Test 4: only symbol= without importLine= is not eligible", () => {
  const parsed = parseUnusedImportEvidence(
    unusedImportFinding(["symbol=Foo"], "src/a.ts")
  );
  assert.equal(parsed.ok, false);
});

await test("Test 5: only importLine= without symbol= is not eligible", () => {
  const parsed = parseUnusedImportEvidence(
    unusedImportFinding(["importLine=import { Foo } from 'bar';"], "src/a.ts")
  );
  assert.equal(parsed.ok, false);
});

await test("Test 7: preflight rejects transformations that introduce parse diagnostics", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meridian-syntax-"));
  try {
    const rel = "src/lib/token-quote.ts";
    await fs.mkdir(path.join(root, "src/lib"), { recursive: true });
    await fs.writeFile(path.join(root, rel), MERIDIAN_TOKEN_QUOTE_GOOD, "utf8");
    const syntax = validateTransformedSourceSyntax({
      filePath: rel,
      originalSource: MERIDIAN_TOKEN_QUOTE_GOOD,
      transformedSource: MERIDIAN_TOKEN_QUOTE_BROKEN,
    });
    assert.equal(syntax.ok, false);
    const finding = unusedImportFinding(
      ["importLine=import { x } from 'y';", "symbol=x"],
      rel
    );
    const preflight = await runFixPreflight(root, finding);
    assert.notEqual(preflight.classification, "actionable_candidate");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

await test("Broken Meridian feed-curation source fails syntax validation vs good", () => {
  const syntax = validateTransformedSourceSyntax({
    filePath: "src/lib/feed-curation.ts",
    originalSource: MERIDIAN_FEED_CURATION_GOOD,
    transformedSource: MERIDIAN_FEED_CURATION_BROKEN,
  });
  assert.equal(syntax.ok, false);
});

console.log("meridian-regression: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
