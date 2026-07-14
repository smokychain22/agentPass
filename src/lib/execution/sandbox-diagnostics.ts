import type { SandboxScriptCheck } from "./sandbox-verification-policy";

export interface StructuredDiagnostic {
  check: string;
  code?: string;
  file?: string;
  line?: number;
  message: string;
}

function normalizeMessage(message: string): string {
  return message
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 200);
}

export function normalizeDiagnosticIdentity(diag: StructuredDiagnostic): string {
  return [
    diag.check,
    diag.code ?? "",
    diag.file ?? "",
    diag.line ?? "",
    normalizeMessage(diag.message),
  ].join("|");
}

/** Extract TypeScript / Next build errors from sandbox stderr. */
export function extractDiagnosticsFromCheck(check: SandboxScriptCheck): StructuredDiagnostic[] {
  const lines = check.stderr.split("\n");
  const diags: StructuredDiagnostic[] = [];

  for (const raw of lines) {
    const line = raw.replace(/\u001b\[[0-9;]*m/g, "").trim();
    if (!line) continue;

    const tscMatch = line.match(/^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/);
    if (tscMatch) {
      diags.push({
        check: check.name,
        code: tscMatch[4],
        file: tscMatch[1].trim(),
        line: Number(tscMatch[2]),
        message: tscMatch[5],
      });
      continue;
    }

    const nextMatch = line.match(/^(.+?):(\d+):(\d+)\s*(?:Type error|Error):\s*(.+)$/i);
    if (nextMatch) {
      diags.push({
        check: check.name,
        file: nextMatch[1].trim(),
        line: Number(nextMatch[2]),
        message: nextMatch[4],
      });
      continue;
    }

    if (/error|failed|syntax/i.test(line) && line.length < 300) {
      diags.push({
        check: check.name,
        message: line,
      });
    }
  }

  return diags;
}

export function patchedErrorsAreSubsetOfBaseline(
  baselineCheck: SandboxScriptCheck,
  patchedCheck: SandboxScriptCheck
): boolean | null {
  const baselineDiags = extractDiagnosticsFromCheck(baselineCheck);
  const patchedDiags = extractDiagnosticsFromCheck(patchedCheck);

  if (baselineDiags.length === 0 || patchedDiags.length === 0) {
    return null;
  }

  const baselineSet = new Set(baselineDiags.map(normalizeDiagnosticIdentity));
  return patchedDiags.every((d) => baselineSet.has(normalizeDiagnosticIdentity(d)));
}
