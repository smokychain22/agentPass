import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("scan-tab-blank-slate");

test("scan tab does not auto-display restored session scan results", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/components/app/scan-tab.tsx"), "utf8");
  assert.match(src, /Blank form until the user pastes/);
  assert.doesNotMatch(src, /useState\(session\.scanResult\)/);
  assert.doesNotMatch(src, /session\.scanComplete \? "complete"/);
  assert.match(src, /const displayResult = result;/);
  assert.match(src, /showSuccess = phase === "complete" && Boolean\(result\)/);
});

test("app header stays idle on scan tab until user leaves scan", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/app/app/page.tsx"), "utf8");
  assert.match(src, /tab === "scan"/);
  assert.match(src, /headerRepoUrl/);
});

console.log("scan-tab-blank-slate: all passed");
