/**
 * Structured, secret-safe diagnostics for supervised CLI command failures.
 *
 * Built after a real production incident where the only failure signal
 * available was `plugin_registered=false` — no exit code, no timeout
 * flag, no stderr excerpt, nothing to distinguish "npm registry hung" from
 * "invalid config" from "permission denied" without manually SSHing into
 * the live container. This module classifies and sanitizes a
 * ProcessRunResult (src/lib/okx-runtime/process-runner.ts) into a small,
 * safe-to-log object.
 */
import type { ProcessRunResult } from "./process-runner";

export type CommandFailureCategory =
  | "timeout"
  | "network_attempt"
  | "invalid_config"
  | "plugin_missing"
  | "plugin_registration_failure"
  | "permission_failure"
  | "gateway_authentication_failure"
  | "unknown";

export interface CommandFailureDiagnostics {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  category: CommandFailureCategory;
  /** Last few lines of the (already-redacted, per process-runner.ts) stderr, bounded in length. */
  stderrTail: string;
  durationMs: number;
  retryDecision: "will_retry" | "fatal" | "no_retry_configured";
}

const MAX_STDERR_TAIL_CHARS = 600;
const MAX_STDERR_TAIL_LINES = 8;

// Additional redaction on top of process-runner.ts's own SECRET_PATTERNS
// (authorization/token/secret/passphrase/private-key/known token
// prefixes) — belt-and-suspenders for the specific secret names named in
// the task spec, in case any ever appears in a raw CLI error string in a
// shape process-runner's generic patterns don't already catch.
const EXTRA_REDACTION_PATTERNS: RegExp[] = [
  /\bOPENCLAW_GATEWAY_TOKEN\b\s*[:=]\s*\S+/gi,
  /\bFLY_API_TOKEN\b\s*[:=]\s*\S+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bBearer\s+[A-Za-z0-9._-]+/g,
];

export function redactDiagnosticText(text: string): string {
  return EXTRA_REDACTION_PATTERNS.reduce(
    (out, pattern) => out.replace(pattern, (match) => `${match.split(/[:=\s]/, 1)[0]}=[redacted]`),
    text
  );
}

function tailLines(text: string, maxLines: number, maxChars: number): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const tail = lines.slice(-maxLines).join(" | ");
  return tail.length > maxChars ? `${tail.slice(0, maxChars)}…` : tail;
}

/**
 * Classification is intentionally conservative: it only claims a specific
 * category when the (already-redacted) stderr/exit signal makes it fairly
 * unambiguous, and falls back to "unknown" rather than guessing.
 */
export function classifyCommandFailure(result: ProcessRunResult): CommandFailureCategory {
  if (result.timedOut) return "timeout";
  const text = `${result.stderr}\n${result.stdout}`.toLowerCase();
  if (/\bnpm\b.*(install|fetch|resolv)|registry\.npmjs\.org|enotfound|econnrefused|network/i.test(text)) {
    return "network_attempt";
  }
  if (/invalid\s+json|unmarshal|unexpected token|not valid json|config is invalid/i.test(text)) {
    return "invalid_config";
  }
  if (/plugin not found|plugin.*not installed|no such plugin/i.test(text)) {
    return "plugin_missing";
  }
  if (/blocked plugin candidate|plugin.*blocked|activation.*failed|registration.*failed/i.test(text)) {
    return "plugin_registration_failure";
  }
  if (/permission denied|eacces|suspicious ownership|expected uid/i.test(text)) {
    return "permission_failure";
  }
  if (/auth_token_missing|unauthoriz|authentication failed|401|forbidden/i.test(text)) {
    return "gateway_authentication_failure";
  }
  return "unknown";
}

export function buildCommandFailureDiagnostics(
  command: string,
  result: ProcessRunResult,
  durationMs: number,
  retryDecision: CommandFailureDiagnostics["retryDecision"]
): CommandFailureDiagnostics {
  const combinedStderr = redactDiagnosticText(result.stderr || result.stdout);
  return {
    command,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    category: classifyCommandFailure(result),
    stderrTail: tailLines(combinedStderr, MAX_STDERR_TAIL_LINES, MAX_STDERR_TAIL_CHARS),
    durationMs,
    retryDecision,
  };
}
