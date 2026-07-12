import assert from "node:assert/strict";
import { findingFingerprint, fingerprintSet } from "../src/lib/verification/finding-fingerprint";
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

function baseFinding(partial: Partial<Finding> & Pick<Finding, "type" | "files">): Finding {
  return {
    id: "f1",
    title: "Test",
    confidence: 0.8,
    confidenceReason: "test",
    severity: "low",
    action: "safe_candidate",
    reason: "test",
    source: "knip",
    sourceMode: "native",
    evidence: { summary: "x", signals: ["symbol=Foo"] },
    ...partial,
  };
}

console.log("finding-fingerprint");

test("stable fingerprint for same finding", () => {
  const f = baseFinding({ type: "unused_import", files: ["src/a.ts"] });
  assert.equal(findingFingerprint(f), findingFingerprint(f));
});

test("different files produce different fingerprints", () => {
  const a = baseFinding({ type: "unused_import", files: ["src/a.ts"] });
  const b = baseFinding({ type: "unused_import", files: ["src/b.ts"] });
  assert.notEqual(findingFingerprint(a), findingFingerprint(b));
});

test("fingerprintSet deduplicates", () => {
  const f = baseFinding({ type: "unused_file", files: ["x.ts"] });
  const set = fingerprintSet([f, { ...f, id: "f2" }]);
  assert.equal(set.size, 1);
});

console.log("finding-fingerprint: all passed");
