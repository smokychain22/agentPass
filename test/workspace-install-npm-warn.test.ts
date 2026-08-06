import assert from "node:assert/strict";
import {
  isNpmLogNoiseLine,
  formatInstallFailureReason,
  humanizeInstallFailure,
  describeProcessTermination,
} from "../src/lib/execution/workspace-install";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log("workspace-install-npm-warn");

/**
 * The exact output shape observed on the Fly runtime for funded job 0x22a2…:
 * a dependency install that emitted only warnings, whose text was then
 * reported as the verification failure cause and propagated into the delivery
 * gate's NO_SAFE_CANDIDATES message.
 */
const PRODUCTION_WARN_OUTPUT = [
  "npm warn config production Use `--omit=dev` instead.",
  "npm warn config Default value does install optional deps unless otherwise omitted.",
  "npm warn deprecated left-pad@1.3.0: use String.prototype.padStart()",
].join("\n");

test("npm warn lines are classified as noise", () => {
  assert.equal(isNpmLogNoiseLine("npm warn deprecated left-pad@1.3.0: use padStart()"), true);
  assert.equal(isNpmLogNoiseLine("npm WARN config Default value does install optional deps"), true);
  assert.equal(isNpmLogNoiseLine("  npm warn config production Use `--omit=dev` instead."), true);
});

test("npm error lines are NOT noise", () => {
  assert.equal(isNpmLogNoiseLine("npm error ERESOLVE unable to resolve dependency tree"), false);
  assert.equal(isNpmLogNoiseLine("npm error code ENOTFOUND"), false);
});

// The regression: warnings must never become the reported cause.
test("warning-only output does not produce a warning-derived failure reason", () => {
  const reason = formatInstallFailureReason("", PRODUCTION_WARN_OUTPUT);
  assert.equal(reason, "Dependency install failed before repository checks could run.");
  assert.doesNotMatch(reason, /left-pad/);
  assert.doesNotMatch(reason, /npm warn/i);
  assert.doesNotMatch(reason, /optional deps/);
});

test("warning-only output on stderr is also suppressed", () => {
  const reason = formatInstallFailureReason(PRODUCTION_WARN_OUTPUT, "");
  assert.doesNotMatch(reason, /left-pad/);
  assert.doesNotMatch(reason, /npm warn/i);
});

test("a real npm error still surfaces, alongside warnings", () => {
  const reason = formatInstallFailureReason(
    `${PRODUCTION_WARN_OUTPUT}\nnpm error ERESOLVE unable to resolve dependency tree`,
    ""
  );
  assert.match(reason, /ERESOLVE/);
  assert.doesNotMatch(reason, /left-pad/);
});

// A fatal condition npm happens to report at warn level must still get through.
test("a warn line carrying ENOSPC is NOT suppressed", () => {
  assert.equal(isNpmLogNoiseLine("npm warn tar ENOSPC no space left on device"), false);
  const reason = formatInstallFailureReason("npm warn tar ENOSPC no space left on device", "");
  assert.match(reason, /ENOSPC|no space left/i);
});

test("humanizeInstallFailure maps ENOSPC to the storage message", () => {
  assert.match(humanizeInstallFailure("ENOSPC no space left on device"), /storage is full/i);
});

test("OOM kill is described explicitly", () => {
  assert.match(
    describeProcessTermination({ exitCode: 137, signal: "SIGKILL" }) ?? "",
    /out of memory/i
  );
  assert.match(describeProcessTermination({ exitCode: 137 }) ?? "", /out of memory/i);
});

test("timeout is described explicitly and takes precedence", () => {
  assert.match(
    describeProcessTermination({ timedOut: true, exitCode: 143, signal: "SIGTERM" }) ?? "",
    /time limit/i
  );
});

test("SIGTERM without timeout is described as terminated", () => {
  assert.match(describeProcessTermination({ signal: "SIGTERM" }) ?? "", /terminated/i);
});

test("a clean non-zero exit yields no termination description", () => {
  assert.equal(describeProcessTermination({ exitCode: 1, signal: null }), null);
  assert.equal(describeProcessTermination({ exitCode: 0 }), null);
});

test("SIGPIPE is reported by signal name rather than silently dropped", () => {
  assert.match(describeProcessTermination({ signal: "SIGPIPE" }) ?? "", /SIGPIPE/);
});

console.log("workspace-install-npm-warn: all tests passed");
