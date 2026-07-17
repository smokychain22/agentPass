import assert from "node:assert/strict";
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

console.log("legacy-findings-route-no-sync");

test("legacy POST /api/jobs/findings must not call runFindingsJob directly", () => {
  const file = path.join(process.cwd(), "src/app/api/jobs/findings/route.ts");
  const source = fs.readFileSync(file, "utf8");
  assert.equal(
    /runFindingsJob\s*\(/.test(source),
    false,
    "legacy findings route must not invoke runFindingsJob()"
  );
  assert.equal(
    /from\s+["']@\/lib\/jobs\/run-findings-job["']/.test(source),
    false,
    "legacy findings route must not import run-findings-job"
  );
  assert.match(source, /findings\/analyze/, "legacy route must delegate to durable analyze");
  assert.match(source, /maxDuration\s*=\s*30/, "legacy route must stay short-lived");
});

test("durable analyze route exists and returns 202 contract", () => {
  const file = path.join(process.cwd(), "src/app/api/findings/analyze/route.ts");
  const source = fs.readFileSync(file, "utf8");
  assert.match(source, /status:\s*202/);
  assert.match(source, /accepted:\s*true/);
  assert.equal(/runFindingsEngine\s*\(/.test(source), false);
  assert.equal(/runKnip\s*\(/.test(source), false);
});

console.log("legacy-findings-route-no-sync: all passed");
