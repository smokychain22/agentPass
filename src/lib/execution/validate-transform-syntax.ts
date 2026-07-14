import ts from "typescript";

function scriptKindForPath(filePath: string): ts.ScriptKind {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".ts")) return ts.ScriptKind.TS;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function parseDiagnostics(filePath: string, source: string): string[] {
  const kind = scriptKindForPath(filePath);
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.Latest,
      jsx: kind === ts.ScriptKind.TSX || kind === ts.ScriptKind.JSX ? ts.JsxEmit.Preserve : ts.JsxEmit.None,
    },
    reportDiagnostics: true,
    fileName: filePath,
  });
  return (result.diagnostics ?? []).map((d: ts.Diagnostic) => {
    const pos = d.start !== undefined ? d.file?.getLineAndCharacterOfPosition(d.start) : undefined;
    const line = pos ? pos.line + 1 : 0;
    const message = ts.flattenDiagnosticMessageText(d.messageText, " ");
    return `${line}:${message}`;
  });
}

export function validateTransformedSourceSyntax(input: {
  filePath: string;
  originalSource: string;
  transformedSource: string;
}): { ok: true } | { ok: false; diagnostics: string[]; reason: string } {
  if (input.originalSource === input.transformedSource) {
    return {
      ok: false,
      diagnostics: [],
      reason: "Transformed source is identical to original.",
    };
  }

  const originalDiags = new Set(parseDiagnostics(input.filePath, input.originalSource));
  const transformedDiags = parseDiagnostics(input.filePath, input.transformedSource);
  const newDiagnostics = transformedDiags.filter((d) => !originalDiags.has(d));

  if (newDiagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: newDiagnostics,
      reason: `Syntax validation failed: ${newDiagnostics.slice(0, 3).join("; ")}`,
    };
  }

  return { ok: true };
}
