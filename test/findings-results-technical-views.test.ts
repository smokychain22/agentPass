import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { outcomeStatusLabel } from "../src/lib/user-directed/recommended-action";
import type { Finding } from "../src/lib/findings/types";

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

function finding(overrides: Partial<Finding>): Finding {
  return {
    id: "f1",
    type: "unused_dependency",
    title: "unused dependency",
    files: ["package.json"],
    packageName: "left-pad",
    confidence: 0.9,
    confidenceReason: "static analysis",
    severity: "low",
    action: "safe_candidate",
    reason: "unused",
    source: "knip",
    sourceMode: "native",
    evidence: { summary: "not imported anywhere", signals: ["classification=actionable_candidate"] },
    ...overrides,
  } as Finding;
}

async function run() {
  console.log("Findings Results/Technical details views");

  test("safe_candidate + preflight-passed finding is Recommended fix", () => {
    const f = finding({
      action: "safe_candidate",
      evidence: { summary: "s", signals: ["classification=actionable_candidate"] },
    });
    assert.equal(outcomeStatusLabel(f), "Recommended fix");
  });

  test("safe_candidate without a passing transformer preflight is Review suggested, not silently dropped", () => {
    const f = finding({
      action: "safe_candidate",
      evidence: { summary: "s", signals: [] },
    });
    assert.equal(outcomeStatusLabel(f), "Review suggested");
  });

  test("review_first finding needs your review", () => {
    const f = finding({ action: "review_first" });
    assert.equal(outcomeStatusLabel(f), "Review suggested");
  });

  test("protected finding is never claimed as an automatic change", () => {
    const f = finding({ action: "do_not_touch", protected: true });
    assert.equal(outcomeStatusLabel(f), "Protected");
  });

  test("status labels are exactly one of the four canonical categories", () => {
    const labels = new Set([
      outcomeStatusLabel(finding({ action: "safe_candidate", evidence: { summary: "s", signals: ["classification=actionable_candidate"] } })),
      outcomeStatusLabel(finding({ action: "safe_candidate", evidence: { summary: "s", signals: [] } })),
      outcomeStatusLabel(finding({ action: "review_first" })),
      outcomeStatusLabel(finding({ action: "do_not_touch", protected: true })),
    ]);
    const allowed = new Set(["Recommended fix", "Review suggested", "Protected", "Informational"]);
    for (const label of labels) {
      assert.ok(allowed.has(label), `"${label}" must be one of the four canonical categories`);
    }
    assert.deepEqual([...labels].sort(), ["Protected", "Recommended fix", "Review suggested"].sort());
  });

  test("Findings review UI exposes only Results and Technical details as primary views", async () => {
    const source = await fs.readFile(
      path.join(ROOT, "src/components/app/user-directed-workbench.tsx"),
      "utf8"
    );
    assert.match(source, /"results"/);
    assert.match(source, /"technical"/);
    assert.match(source, /Technical details/);
    // The old nested Review/Plan/Pay/Delivery stage switcher and three-way
    // Automatic Cleanup/Guided Review/Advanced mode switcher must be gone.
    assert.doesNotMatch(source, /Product workflow stages/);
    assert.doesNotMatch(source, /data-stage-count/);
    assert.doesNotMatch(source, /Advanced repository explorer/);
    assert.doesNotMatch(source, />Automatic Cleanup</);
    assert.doesNotMatch(source, />Guided Review</);
  });

  console.log("Findings Results/Technical details views: all passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
