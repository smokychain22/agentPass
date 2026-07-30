/**
 * Structured, secret-safe command-failure diagnostics
 * (src/lib/okx-runtime/command-diagnostics.ts) — built after a real
 * production incident where the only failure signal available was
 * `plugin_registered=false`, with no exit code, timeout flag, or stderr
 * excerpt to distinguish "npm registry hung" from "invalid config" from
 * "permission denied" without SSHing into the live container.
 */
import assert from "node:assert/strict";

import {
  redactDiagnosticText,
  classifyCommandFailure,
  buildCommandFailureDiagnostics,
} from "../src/lib/okx-runtime/command-diagnostics";
import type { ProcessRunResult } from "../src/lib/okx-runtime/process-runner";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function result(overrides: Partial<ProcessRunResult>): ProcessRunResult {
  return {
    ok: false,
    exitCode: 1,
    signal: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    cancelled: false,
    ...overrides,
  };
}

function run() {
  console.log("command-diagnostics");

  // --- Redaction -------------------------------------------------------

  test("redactDiagnosticText redacts OPENCLAW_GATEWAY_TOKEN values", () => {
    const out = redactDiagnosticText("failed: OPENCLAW_GATEWAY_TOKEN=abc123supersecretvalue rejected");
    assert.ok(!out.includes("abc123supersecretvalue"));
    assert.ok(out.includes("OPENCLAW_GATEWAY_TOKEN=[redacted]"));
  });

  test("redactDiagnosticText redacts FLY_API_TOKEN values", () => {
    const out = redactDiagnosticText("env dump: FLY_API_TOKEN=fo1_reallysecretvalue123");
    assert.ok(!out.includes("fo1_reallysecretvalue123"));
    assert.ok(out.includes("FLY_API_TOKEN=[redacted]"));
  });

  test("redactDiagnosticText redacts PEM private key blocks entirely", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234567890abcdef\n-----END RSA PRIVATE KEY-----";
    const out = redactDiagnosticText(`config error near: ${pem}`);
    assert.ok(!out.includes("MIIEowIBAAKCAQEA1234567890abcdef"));
  });

  test("redactDiagnosticText redacts Bearer tokens", () => {
    const out = redactDiagnosticText("request failed with header Authorization: Bearer abcDEF123.token-value_here");
    assert.ok(!out.includes("abcDEF123.token-value_here"));
    assert.ok(out.includes("[redacted]"));
  });

  test("redactDiagnosticText leaves ordinary diagnostic text unchanged", () => {
    const text = "openclaw gateway run exited with code 1 after 4013ms";
    assert.equal(redactDiagnosticText(text), text);
  });

  // --- Classification ----------------------------------------------------

  test("classifyCommandFailure: timeout takes precedence over any stderr content", () => {
    const r = result({ timedOut: true, stderr: "permission denied for good measure" });
    assert.equal(classifyCommandFailure(r), "timeout");
  });

  test("classifyCommandFailure: network_attempt for npm install/registry failures", () => {
    assert.equal(classifyCommandFailure(result({ stderr: "npm ERR! network request to registry.npmjs.org failed" })), "network_attempt");
    assert.equal(classifyCommandFailure(result({ stderr: "getaddrinfo ENOTFOUND registry.npmjs.org" })), "network_attempt");
  });

  test("classifyCommandFailure: invalid_config for JSON/schema failures", () => {
    assert.equal(classifyCommandFailure(result({ stderr: "SyntaxError: Unexpected token } in JSON at position 42" })), "invalid_config");
    assert.equal(classifyCommandFailure(result({ stderr: "config is invalid: gateway.mode must be one of local, remote" })), "invalid_config");
  });

  test("classifyCommandFailure: plugin_missing when the plugin cannot be found", () => {
    assert.equal(classifyCommandFailure(result({ stderr: "Error: plugin not found: okx-a2a" })), "plugin_missing");
  });

  test("classifyCommandFailure: plugin_registration_failure for blocked/failed activation", () => {
    assert.equal(
      classifyCommandFailure(result({ stderr: "blocked plugin candidate: suspicious ownership (expected uid=0 or root)" })),
      "plugin_registration_failure"
    );
    assert.equal(classifyCommandFailure(result({ stderr: "plugin activation failed for repodiet-a2a-bridge" })), "plugin_registration_failure");
  });

  test("classifyCommandFailure: permission_failure for EACCES/ownership errors", () => {
    assert.equal(classifyCommandFailure(result({ stderr: "EACCES: permission denied, open '/persistent/home/.openclaw/openclaw.json'" })), "permission_failure");
  });

  test("classifyCommandFailure: gateway_authentication_failure for auth rejections", () => {
    assert.equal(classifyCommandFailure(result({ stderr: "AUTH_TOKEN_MISSING: gateway rejected connection" })), "gateway_authentication_failure");
    assert.equal(classifyCommandFailure(result({ stderr: "request failed: 401 Unauthorized" })), "gateway_authentication_failure");
  });

  test("classifyCommandFailure: falls back to unknown rather than guessing", () => {
    assert.equal(classifyCommandFailure(result({ stderr: "some completely unrelated failure text" })), "unknown");
  });

  // --- Full diagnostics assembly ------------------------------------------

  test("buildCommandFailureDiagnostics assembles command, exitCode, timedOut, category, stderrTail, durationMs, retryDecision", () => {
    const r = result({ exitCode: 127, stderr: "line1\nline2\nplugin not found: okx-a2a" });
    const diag = buildCommandFailureDiagnostics("openclaw plugins inspect okx-a2a", r, 4321, "fatal");
    assert.equal(diag.command, "openclaw plugins inspect okx-a2a");
    assert.equal(diag.exitCode, 127);
    assert.equal(diag.timedOut, false);
    assert.equal(diag.category, "plugin_missing");
    assert.equal(diag.durationMs, 4321);
    assert.equal(diag.retryDecision, "fatal");
    assert.ok(diag.stderrTail.includes("plugin not found: okx-a2a"));
  });

  test("buildCommandFailureDiagnostics falls back to stdout when stderr is empty", () => {
    const r = result({ stderr: "", stdout: "some diagnostic printed to stdout instead" });
    const diag = buildCommandFailureDiagnostics("cmd", r, 10, "no_retry_configured");
    assert.ok(diag.stderrTail.includes("some diagnostic printed to stdout instead"));
  });

  test("buildCommandFailureDiagnostics truncates to the last lines/chars, not the first — the failure signal is usually at the end", () => {
    const manyLines = Array.from({ length: 40 }, (_, i) => `log line ${i}`).join("\n");
    const r = result({ stderr: `${manyLines}\nFATAL: the real error` });
    const diag = buildCommandFailureDiagnostics("cmd", r, 10, "will_retry");
    assert.ok(diag.stderrTail.includes("FATAL: the real error"), "the final, most relevant line must survive truncation");
    assert.ok(!diag.stderrTail.includes("log line 0"), "old, early lines must be dropped once truncated");
  });

  test("buildCommandFailureDiagnostics redacts secret-shaped text before truncation, so a secret can never survive in the tail", () => {
    const r = result({ stderr: "connecting with OPENCLAW_GATEWAY_TOKEN=verysecretvalue123 failed" });
    const diag = buildCommandFailureDiagnostics("cmd", r, 10, "fatal");
    assert.ok(!diag.stderrTail.includes("verysecretvalue123"));
  });

  console.log("command-diagnostics: all passed");
}

run();
