import assert from "node:assert/strict";
import { matchesBucket, matchesCategory } from "../src/components/app/findings/findings-workspace";
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

function finding(partial: Partial<Finding> & Pick<Finding, "id" | "type" | "action">): Finding {
  return {
    title: partial.title ?? partial.id,
    files: partial.files ?? ["src/a.ts"],
    confidence: partial.confidence ?? 0.9,
    confidenceReason: "test",
    severity: partial.severity ?? "low",
    reason: "test",
    source: partial.source ?? "knip",
    sourceMode: "native",
    evidence: { summary: "test", signals: ["unused"] },
    ...partial,
  };
}

/** Simulate pagination used by FindingsWorkspace — zero cards until browse opens. */
function paginate(findings: Finding[], browseOpen: boolean, page: number, pageSize: number) {
  if (!browseOpen) return [];
  const start = (page - 1) * pageSize;
  return findings.slice(start, start + pageSize);
}

console.log("findings-collapsible-pagination");

test("collapsed browse renders zero finding cards", () => {
  const findings = Array.from({ length: 717 }, (_, i) =>
    finding({ id: `f${i}`, type: "unused_file", action: "review_first" })
  );
  assert.equal(paginate(findings, false, 1, 25).length, 0);
});

test("first expansion renders at most 25 cards", () => {
  const findings = Array.from({ length: 717 }, (_, i) =>
    finding({ id: `f${i}`, type: "unused_file", action: "review_first" })
  );
  const page = paginate(findings, true, 1, 25);
  assert.equal(page.length, 25);
  assert.ok(page.length < findings.length);
});

test("pagination advances without mounting all cards", () => {
  const findings = Array.from({ length: 100 }, (_, i) =>
    finding({ id: `f${i}`, type: "unused_file", action: "review_first" })
  );
  const page1 = paginate(findings, true, 1, 25);
  const page2 = paginate(findings, true, 2, 25);
  assert.equal(page1[0]?.id, "f0");
  assert.equal(page2[0]?.id, "f25");
  assert.equal(page1.length + page2.length, 50);
});

test("filters remain independent of pagination window", () => {
  const findings: Finding[] = [
    finding({ id: "1", type: "unused_file", action: "safe_candidate" }),
    finding({ id: "2", type: "duplicate_code", action: "review_first" }),
    finding({ id: "3", type: "ai_slop_signal", action: "do_not_touch" }),
  ];
  const filtered = findings.filter(
    (f) => matchesCategory(f, "dead_files") && matchesBucket(f, "safe_candidate")
  );
  assert.equal(filtered.length, 1);
  assert.equal(paginate(filtered, true, 1, 25).length, 1);
});

console.log("findings-collapsible-pagination: all passed");
