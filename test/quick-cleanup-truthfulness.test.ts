import assert from "node:assert/strict";
import { deduplicateCanonicalFindings } from "../src/lib/findings/canonical-findings";
import type { Finding } from "../src/lib/findings/types";

function sampleFinding(id: string, file: string, symbol: string): Finding {
  return {
    id,
    type: "unused_import",
    title: `Unused import: ${symbol}`,
    files: [file],
    confidence: 0.9,
    confidenceReason: "test",
    severity: "low",
    action: "safe_candidate",
    reason: "test",
    source: "heuristic",
    sourceMode: "heuristic",
    evidence: {
      summary: "test",
      signals: [`symbol=${symbol}`, `importLine=import { ${symbol} } from "x";`],
    },
  };
}

function testCanonicalDedupMirroredImports(): void {
  const findings = [
    sampleFinding("a", "agora-forge/src/lib/a.ts", "Clock"),
    sampleFinding("b", "src/lib/a.ts", "Clock"),
  ];
  const deduped = deduplicateCanonicalFindings(findings);
  assert.equal(deduped.length, 1);
}

testCanonicalDedupMirroredImports();
console.log("quick-cleanup-truthfulness.test.ts: ok");
