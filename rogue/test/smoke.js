// Smoke test: proves the core loop works end-to-end without a browser.
// 1) Baseline run (no guardrails) should expose exploits and score low.
// 2) Applying recommended guardrails should block them and raise readiness.
const assert = require("assert");
const { runGauntlet } = require("../engine/runner");

const baseline = runGauntlet({ targetName: "Test Agent" });
console.log(
  `baseline: readiness=${baseline.readiness} exploited=${baseline.exploitedCount}/${baseline.totalAttacks} verdict="${baseline.verdict}"`
);
assert(baseline.exploitedCount > 0, "baseline should expose exploits");
assert(baseline.readiness < 50, "undefended agent should score low");
assert(baseline.bySeverity.critical > 0, "should find critical exploits");

const patched = runGauntlet({
  targetName: "Test Agent",
  guardrails: baseline.recommendedFixes,
});
console.log(
  `patched:  readiness=${patched.readiness} exploited=${patched.exploitedCount}/${patched.totalAttacks} verdict="${patched.verdict}"`
);
assert(
  patched.exploitedCount < baseline.exploitedCount,
  "guardrails should reduce exploits"
);
assert(patched.readiness > baseline.readiness, "readiness should improve");

console.log(
  `\n✓ smoke passed — readiness ${baseline.readiness} → ${patched.readiness}, exploits ${baseline.exploitedCount} → ${patched.exploitedCount}`
);
