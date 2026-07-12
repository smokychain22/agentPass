import assert from "node:assert/strict";
import type { Finding } from "../src/lib/findings/types";
import { buildRemediationPlan, classifyFindingRemediation } from "../src/lib/patch-kit/remediation-class";
import { buildVerificationGateReport } from "../src/lib/patch-kit/verification-gates";
import type { PatchKitPayload } from "../src/lib/patch-kit/types";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("remediation-class");

function baseFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    type: "unused_import",
    title: "Unused import Clock",
    files: ["src/Dashboard.tsx"],
    confidence: 0.9,
    confidenceReason: "knip",
    severity: "low",
    action: "safe_candidate",
    reason: "Import never referenced",
    source: "knip",
    sourceMode: "native",
    evidence: { summary: "unused", signals: ["symbol=Clock", "preflight=actionable_candidate"] },
    confidenceTier: "verified",
    evidenceBundle: {
      analyzerEvidence: [],
      graphEvidence: [],
      frameworkEvidence: [],
      configurationEvidence: [],
      scriptEvidence: [],
      runtimeEvidence: [],
      gitEvidence: [],
      counterEvidence: [],
      unresolvedRisks: [],
      grade: "strong",
      classificationState: "supported",
      classificationLabel: "unused_import_confirmed",
      decisionReason: "Strong",
      autoFixAllowed: true,
    },
    ...overrides,
  };
}

test("unused import with verified tier is green", () => {
  const c = classifyFindingRemediation(baseFinding());
  assert.equal(c.remediationClass, "green");
  assert.equal(c.autoFixAllowed, true);
});

test("auth path is red regardless of tier", () => {
  const c = classifyFindingRemediation(
    baseFinding({ files: ["src/auth/login.ts"], type: "unused_file" })
  );
  assert.equal(c.remediationClass, "red");
  assert.equal(c.autoFixAllowed, false);
});

test("orphan pattern defaults to yellow", () => {
  const c = classifyFindingRemediation(
    baseFinding({
      type: "orphan_pattern",
      confidenceTier: "high_confidence",
      files: ["src/lib/orphan.ts"],
    })
  );
  assert.equal(c.remediationClass, "yellow");
  assert.equal(c.draftPatchOnly, true);
});

test("verification gates block when patch validation failed", () => {
  const report = buildVerificationGateReport({
    id: "pk1",
    repo: { owner: "o", name: "r", branch: "main" },
    summary: { validatedChanges: 1, verifiedChanges: 0 } as PatchKitPayload["summary"],
    patchValidation: { status: "failed", error: "apply failed" },
  } as PatchKitPayload);
  assert.equal(report.allRequiredPassed, false);
  assert.ok(report.gates.some((g) => g.id === "patch_git_apply" && g.status === "failed"));
});

test("remediation plan counts tiers", () => {
  const plan = buildRemediationPlan([
    baseFinding(),
    baseFinding({ id: "f2", type: "orphan_pattern", files: ["src/a.ts"], confidenceTier: "high_confidence" }),
  ]);
  assert.ok(plan.summary.greenCount >= 1);
  assert.ok(plan.summary.yellowCount >= 1);
});

console.log("remediation-class: all passed");
