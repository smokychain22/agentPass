import assert from "node:assert/strict";
import { findingsPayloadToSarif, findingToSarifResult } from "../src/lib/findings/sarif-export";
import type { Finding, FindingsPayload } from "../src/lib/findings/types";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const sampleFinding: Finding = {
  id: "fnd_abc",
  type: "unused_import",
  title: "Unused import",
  files: ["src/lib.ts"],
  confidence: 0.9,
  confidenceTier: "verified",
  confidenceReason: "test",
  severity: "low",
  action: "safe_candidate",
  reason: "Symbol unused",
  source: "repodiet_import",
  sourceMode: "native",
  evidence: { summary: "x", signals: ["symbol=Foo"] },
};

console.log("sarif-export");

test("findingToSarifResult includes fingerprint and rule id", () => {
  const result = findingToSarifResult(sampleFinding);
  assert.equal(result.ruleId, "repodiet/unused_import");
  assert.equal(result.properties?.finding_id, "fnd_abc");
  assert.ok(typeof result.properties?.fingerprint === "string");
});

test("findingsPayloadToSarif produces SARIF 2.1.0", () => {
  const payload = {
    scanId: "scan_1",
    repo: { owner: "o", name: "r", branch: "main" },
    mode: "live" as const,
    summary: {} as FindingsPayload["summary"],
    duplicates: [],
    unused: { files: [], dependencies: [], exports: [sampleFinding] },
    orphans: [],
    slopSignals: [],
    riskBuckets: { safeDelete: [], reviewFirst: [], doNotTouch: [] },
    artifacts: { findingsJson: true },
    rawToolReports: {
      knip: { status: "ok" as const, source: "knip" as const, sourceMode: "native" as const, durationMs: 1 },
      jscpd: { status: "ok" as const, source: "jscpd" as const, sourceMode: "native" as const, durationMs: 1 },
      madge: { status: "ok" as const, source: "madge" as const, sourceMode: "native" as const, durationMs: 1 },
    },
  } satisfies FindingsPayload;

  const sarif = findingsPayloadToSarif(payload);
  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs[0]?.results.length, 1);
});

console.log("sarif-export: all passed");
