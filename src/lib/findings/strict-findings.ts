import type { FindingsPayload, Finding } from "./types";
import {
  buildAnalyzerState,
  buildHeuristicsState,
  filterProductFindings,
  isKnipAvailable,
} from "./analyzer-availability";
export function applyStrictFindingsMode(payload: FindingsPayload): FindingsPayload {
  const reports = payload.rawToolReports;
  const flat: Finding[] = [
    ...payload.duplicates,
    ...payload.unused.files,
    ...payload.unused.dependencies,
    ...payload.unused.exports,
    ...payload.orphans,
    ...payload.slopSignals,
  ];

  const { product, excluded } = filterProductFindings(flat, reports);

  const byType = (type: Finding["type"]) => product.filter((f) => f.type === type);
  const unusedFiles = byType("unused_file");
  const unusedDeps = byType("unused_dependency");
  const unusedExports = byType("unused_export");
  const unusedImports = byType("unused_import");
  const duplicates = byType("duplicate_code");
  const orphans = byType("orphan_pattern");
  const slop = byType("ai_slop_signal");

  const excludedByType = (type: Finding["type"]) => excluded.filter((f) => f.type === type).length;

  const diagnostics = payload.diagnostics ?? {
    fallbackFindings: excluded.filter((f) => f.source.endsWith("_fallback")),
    excludedCounts: {
      duplicates: excludedByType("duplicate_code"),
      unusedFiles: excludedByType("unused_file"),
      unusedDependencies: excludedByType("unused_dependency"),
      unusedExports: excludedByType("unused_export"),
      orphans: excludedByType("orphan_pattern"),
    },
    analyzerErrors: {
      knip: reports.knip.status !== "ok" ? reports.knip.error : undefined,
      jscpd: reports.jscpd.status !== "ok" ? reports.jscpd.error : undefined,
      madge: reports.madge.status !== "ok" ? reports.madge.error : undefined,
    },
  };

  const riskBuckets = {
    safeDelete: product.filter((f) => f.action === "safe_candidate").map((f) => f.id),
    reviewFirst: product.filter((f) => f.action === "review_first").map((f) => f.id),
    doNotTouch: product.filter((f) => f.action === "do_not_touch").map((f) => f.id),
  };

  return {
    ...payload,
    duplicates,
    unused: {
      files: unusedFiles,
      dependencies: unusedDeps,
      exports: [...unusedExports, ...unusedImports],
    },
    orphans,
    slopSignals: slop,
    riskBuckets,
    diagnostics,
    analyzerStates: payload.analyzerStates ?? {
      knip: buildAnalyzerState("knip", {
        status: reports.knip.status,
        source: reports.knip.source,
        sourceMode: reports.knip.sourceMode,
        report: null,
        error: reports.knip.error,
        version: reports.knip.version,
        durationMs: reports.knip.durationMs,
      }),
      jscpd: buildAnalyzerState("jscpd", {
        status: reports.jscpd.status,
        source: reports.jscpd.source,
        sourceMode: reports.jscpd.sourceMode,
        report: null,
        error: reports.jscpd.error,
        version: reports.jscpd.version,
        durationMs: reports.jscpd.durationMs,
      }),
      madge: buildAnalyzerState("madge", {
        status: reports.madge.status,
        source: reports.madge.source,
        sourceMode: reports.madge.sourceMode,
        report: null,
        error: reports.madge.error,
        version: reports.madge.version,
        durationMs: reports.madge.durationMs,
      }),
      heuristics: buildHeuristicsState(),
    },
  };
}

export { isKnipAvailable };
