import type { AnalyzerRunResult, AnalyzerSource, SourceMode, ToolStatus } from "./types";

export function analyzerSourceFor(
  tool: "knip" | "jscpd" | "madge",
  status: ToolStatus
): AnalyzerSource {
  if (status === "ok") return tool;
  if (status === "fallback") {
    if (tool === "knip") return "internal_import_graph";
    if (tool === "jscpd") return "internal_duplicate_detector";
    return "internal_dependency_graph";
  }
  return null;
}

export function sourceModeFor(status: ToolStatus): SourceMode {
  if (status === "ok") return "native";
  if (status === "fallback") return "fallback";
  return "heuristic";
}

export async function timedAnalyzer<T>(
  tool: "knip" | "jscpd" | "madge",
  run: () => Promise<AnalyzerRunResult<T>>
): Promise<AnalyzerRunResult<T>> {
  const started = Date.now();
  const result = await run();
  const durationMs = Date.now() - started;
  return {
    ...result,
    source: result.source ?? analyzerSourceFor(tool, result.status),
    sourceMode: result.sourceMode ?? sourceModeFor(result.status),
    durationMs,
  };
}

export function finalizeAnalyzerResult<T>(
  tool: "knip" | "jscpd" | "madge",
  status: ToolStatus,
  report: T | null,
  error: string | undefined,
  durationMs: number,
  version?: string
): AnalyzerRunResult<T> {
  return {
    status,
    source: analyzerSourceFor(tool, status),
    sourceMode: sourceModeFor(status),
    report,
    error,
    version,
    durationMs,
  };
}
