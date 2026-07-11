import assert from "node:assert/strict";
import {
  detectUnusedImportsInSource,
  removeUnusedImportLine,
  removeUnusedSymbolFromImport,
} from "../src/lib/findings/unused-import-detector";
import { isPhase1AutoFix } from "../src/lib/execution/fix-plugins/phase1-plugins";
import type { Finding } from "../src/lib/findings/types";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("Phase 1 free proof tests");

test("detects unused named import", () => {
  const source = `import { unused, used } from "lodash";\n\nexport function foo() { return used; }\n`;
  const found = detectUnusedImportsInSource("src/a.ts", source);
  assert.ok(found.some((f) => f.symbol.includes("unused")));
});

test("type-only import used in signature is not flagged", () => {
  const source = `import { clsx, type ClassValue } from "clsx";\n\nexport function cn(...inputs: ClassValue[]) {\n  return clsx(inputs);\n}\n`;
  const found = detectUnusedImportsInSource("lib/utils-copy.ts", source);
  assert.equal(found.length, 0);
});

test("removes single unused symbol from named import", () => {
  const source = `import { unused, used } from "lodash";\n\nexport const x = used;\n`;
  const out = removeUnusedSymbolFromImport(
    source,
    'import { unused, used } from "lodash";',
    "unused"
  );
  assert.match(out, /import \{ used \} from "lodash"/);
  assert.ok(!out.includes("unused"));
});

test("temp file path eligible under phase1 with safe_candidate", () => {
  const finding: Finding = {
    id: "f1",
    type: "unused_file",
    title: "Temp file",
    files: ["tmp/temp-widget.tsx"],
    confidence: 0.9,
    confidenceReason: "test",
    severity: "low",
    action: "safe_candidate",
    reason: "Unreachable temp file",
    source: "knip_fallback",
    sourceMode: "fallback",
    evidence: { summary: "test", signals: ["path=tmp/temp-widget.tsx"] },
  };
  assert.equal(isPhase1AutoFix(finding), true);
});

console.log("All Phase 1 free proof tests passed.");
