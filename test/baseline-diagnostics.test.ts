import assert from "node:assert/strict";
import {
  classifyBaselineFailure,
  parseBaselineBuildDiagnostic,
} from "../src/lib/workflow/baseline-diagnostics";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("baseline-diagnostics");

test("parses Next.js TypeScript build diagnostic with file line column", () => {
  const stderr = `Failed to type check.

./src/app/api/nexus/feed/route.ts:88:41
Type error: Type 'TokenSecurityReport | undefined' is not assignable to type 'Pick<TokenSecurityReport, "honeypotRisk" | "scamRisk" | "label" | "scamLabel"> | undefined'.
  Property 'scamRisk' is optional in type 'TokenSecurityReport' but required in type 'Pick<TokenSecurityReport, "honeypotRisk" | "scamRisk" | "label" | "scamLabel">'.`;

  const parsed = parseBaselineBuildDiagnostic(stderr);
  assert.equal(parsed?.filePath, "src/app/api/nexus/feed/route.ts");
  assert.equal(parsed?.line, 88);
  assert.equal(parsed?.column, 41);
  assert.match(parsed?.message ?? "", /scamRisk/);
});

test("classifies compiler failures as pre_existing_repository_error", () => {
  const classification = classifyBaselineFailure({
    failedCheck: "npm run build",
    stderrExcerpt: "Type error: Cannot find module 'date-fns'",
  });
  assert.equal(classification, "pre_existing_repository_error");
});

console.log("baseline-diagnostics: all passed");
