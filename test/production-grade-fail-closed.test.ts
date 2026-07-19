/**
 * Production-grade fail-closed gates — no beta shortcuts counted as success.
 */
import assert from "node:assert/strict";
import { verifyPayment as verifyLegacyX402 } from "../lib/x402.js";
import { REPOSITORY_SUPPORT_MATRIX } from "../src/lib/product/support-matrix";
import { PRODUCT_CAPABILITY_MATRIX } from "../src/lib/product/capability-matrix";
import { TERMINAL_COVERAGE_OUTCOMES } from "../src/lib/coverage/outcomes";
import {
  mapTechnicalErrorToProductFailure,
  productFailure,
} from "../src/lib/product/failure-states";
import { buildHealthResponse } from "../src/lib/a2mcp/tool-manifest";
import fs from "node:fs";
import path from "node:path";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("production-grade-fail-closed");

test("legacy x402 rejects bare signature under REQUIRE_REAL_X402", () => {
  const prev = process.env.REQUIRE_REAL_X402;
  process.env.REQUIRE_REAL_X402 = "1";
  try {
    const result = verifyLegacyX402(
      { headers: { "payment-signature": "0xfake" } },
      "30000"
    );
    assert.equal(result.ok, false);
  } finally {
    if (prev === undefined) delete process.env.REQUIRE_REAL_X402;
    else process.env.REQUIRE_REAL_X402 = prev;
  }
});

test("support matrix never claims universal language support", () => {
  assert.equal(REPOSITORY_SUPPORT_MATRIX.claims.universalLanguageSupport, false);
  assert.equal(REPOSITORY_SUPPORT_MATRIX.claims.wslIsExecutionEnvironmentNotLanguage, true);
  const wsl = REPOSITORY_SUPPORT_MATRIX.languages.find((l) => l.id === "wsl");
  assert.ok(wsl);
  assert.equal(wsl!.semanticAnalysis, false);
  const py = REPOSITORY_SUPPORT_MATRIX.languages.find((l) => l.id === "python");
  assert.ok(py);
  assert.equal(py!.semanticAnalysis, false);
  assert.equal(py!.analysisLevel, "TEXTUALLY_ANALYZED");
  const ts = REPOSITORY_SUPPORT_MATRIX.languages.find((l) => l.id === "typescript");
  assert.equal(ts!.semanticAnalysis, true);
  assert.equal(ts!.analysisLevel, "SEMANTICALLY_ANALYZED");
});

test("capability matrix lists GitHub PR as not externally proven by default", () => {
  const gh = PRODUCT_CAPABILITY_MATRIX.capabilities.find(
    (c) => c.id === "github_app_pr_delivery"
  );
  assert.ok(gh);
  assert.equal(gh!.implemented, true);
  assert.equal(gh!.realExternalActionProven, false);
});

test("coverage outcomes include symlink/submodule/unavailable levels", () => {
  for (const outcome of [
    "SEMANTICALLY_ANALYZED",
    "SYNTAX_ANALYZED",
    "TEXTUALLY_ANALYZED",
    "SYMLINK_REPRESENTED",
    "SUBMODULE_REPRESENTED",
    "UNAVAILABLE_WITH_REASON",
  ]) {
    assert.ok(TERMINAL_COVERAGE_OUTCOMES.includes(outcome as never), outcome);
  }
});

test("tools health is manifest listing only, not readiness proof", () => {
  const health = buildHealthResponse();
  assert.equal(health.ready, false);
  assert.equal(health.probeKind, "manifest_listing_only");
});

test("user-facing failures hide raw CLI noise", () => {
  const mapped = mapTechnicalErrorToProductFailure("git exited with code 1: gh auth failed");
  assert.equal(mapped.code, "GITHUB_ACCESS_REQUIRED");
  assert.match(mapped.nextAction, /Install the RepoDiet GitHub App/i);
  const view = productFailure("VALIDATION_FAILED");
  assert.equal(view.paymentStillUsable, true);
});

test("mandatory CI workflow exists for pull_request", () => {
  const ci = fs.readFileSync(
    path.join(process.cwd(), ".github/workflows/ci.yml"),
    "utf8"
  );
  assert.match(ci, /pull_request:/);
  assert.match(ci, /npm run typecheck/);
  assert.match(ci, /npm test/);
  assert.match(ci, /npm run build/);
  assert.match(ci, /production-grade-fail-closed/);
});

test("verify scripts no longer pass unsigned receipts / missing PRs", () => {
  const a2a = fs.readFileSync(
    path.join(process.cwd(), "scripts/verify-a2a-production.ts"),
    "utf8"
  );
  const asp = fs.readFileSync(
    path.join(process.cwd(), "scripts/verify-asp-production.ts"),
    "utf8"
  );
  assert.doesNotMatch(a2a, /acceptable in beta/);
  assert.doesNotMatch(a2a, /delivery_failed without GitHub token — honest/);
  assert.match(a2a, /not acceptable for production verification/);
  assert.match(asp, /not acceptable for production verification/);
});

console.log("production-grade-fail-closed: PASS");
