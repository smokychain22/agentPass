import assert from "node:assert/strict";
import { filterFindingsToPrimaryRoot } from "../src/lib/findings/canonical-findings";
import type { Finding } from "../src/lib/findings/types";

function duplicateFinding(files: string[]): Finding {
  return {
    id: `dup-${files.join("-")}`,
    type: "duplicate_code",
    title: "Duplicate",
    files,
    confidence: 0.8,
    confidenceReason: "test",
    severity: "medium",
    action: "review_first",
    reason: "test",
    source: "jscpd_fallback",
    sourceMode: "fallback",
    evidence: { summary: "test", signals: [] },
  };
}

function unusedImport(file: string): Finding {
  return {
    id: `import-${file}`,
    type: "unused_import",
    title: "Unused import",
    files: [file],
    confidence: 0.9,
    confidenceReason: "test",
    severity: "low",
    action: "safe_candidate",
    reason: "test",
    source: "heuristic",
    sourceMode: "heuristic",
    evidence: { summary: "test", signals: ["symbol=Foo"] },
  };
}

const mirrors = ["agora-forge"];

assert.equal(
  filterFindingsToPrimaryRoot([unusedImport("agora-forge/src/a.ts")], "", mirrors).length,
  0
);
assert.equal(
  filterFindingsToPrimaryRoot([unusedImport("src/a.ts")], "", mirrors).length,
  1
);

const dup = duplicateFinding(["src/a.ts", "agora-forge/src/a.ts"]);
const filteredDup = filterFindingsToPrimaryRoot([dup], "", mirrors);
assert.equal(filteredDup.length, 1);
assert.deepEqual(filteredDup[0].files, ["src/a.ts"]);

console.log("mirror-path-filter.test.ts: ok");
