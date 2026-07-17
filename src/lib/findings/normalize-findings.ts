import { nanoid } from "nanoid";
import type {
  AnalyzerRunResult,
  Finding,
  FindingEvidence,
  FindingSource,
  FindingsPayload,
  FindingsSummary,
  JscpdRawReport,
  KnipRawReport,
  MadgeRawReport,
  SlopRawSignal,
  SourceMode,
  ToolRunReport,
} from "./types";
import type { RepoInfo } from "@/lib/scanner/prepare-workspace";
import {
  classifyAction,
  clampConfidence,
  isDoNotTouchPath,
  isRouteLikePath,
  normalizeRepoPath,
  severityForAction,
} from "./confidence";
import { assertFindingsInvariants, buildSummaryFromFindings } from "./stats";

interface NormalizeInput {
  scanId: string;
  repo: RepoInfo;
  rootDir: string;
  knip: KnipRawReport | null;
  knipResult: AnalyzerRunResult<KnipRawReport>;
  jscpd: JscpdRawReport | null;
  jscpdResult: AnalyzerRunResult<JscpdRawReport>;
  madge: MadgeRawReport | null;
  madgeResult: AnalyzerRunResult<MadgeRawReport>;
  slop: SlopRawSignal[];
  mode: "demo" | "live";
}

function sourceModeForFinding(source: FindingSource): SourceMode {
  if (source.endsWith("_fallback")) return "fallback";
  if (source === "heuristic") return "heuristic";
  return "native";
}

function makeEvidence(summary: string, signals: string[]): FindingEvidence {
  return { summary, signals };
}

function makeFinding(
  partial: Omit<Finding, "id" | "severity" | "action" | "evidence" | "confidenceReason" | "sourceMode"> & {
    action?: Finding["action"];
    evidence: FindingEvidence;
    confidenceReason: string;
  }
): Finding {
  const files = partial.files.map((f) => f.replace(/\\/g, "/"));
  const action =
    partial.action ?? classifyAction(files, { type: partial.type, forceReview: partial.type === "duplicate_code" });
  return {
    id: `fnd_${nanoid(10)}`,
    severity: severityForAction(action),
    action,
    sourceMode: sourceModeForFinding(partial.source),
    ...partial,
    files,
    confidence: clampConfidence(partial.confidence),
  };
}

function fromKnip(report: KnipRawReport | null, rootDir: string, source: FindingSource) {
  const files: Finding[] = [];
  const dependencies: Finding[] = [];
  const exports: Finding[] = [];
  const seenFiles = new Set<string>();
  const seenDeps = new Set<string>();
  const seenExports = new Set<string>();

  for (const issue of report?.issues ?? []) {
    for (const f of issue.files ?? []) {
      const rel = normalizeRepoPath(rootDir, f.name);
      if (!rel || seenFiles.has(rel) || isDoNotTouchPath(rel)) continue;
      seenFiles.add(rel);
      const routeLike = isRouteLikePath(rel);
      const action = routeLike
        ? "do_not_touch"
        : classifyAction([rel], { type: "unused_file", source });
      const inboundImports = 0;
      const confidence = routeLike ? 0.45 : inboundImports === 0 ? 0.76 : 0.55;
      files.push(
        makeFinding({
          type: "unused_file",
          title: "Unused file",
          files: [rel],
          confidence,
          action,
          reason: routeLike
            ? "Framework route file — may be valid without direct imports."
            : source === "knip_fallback"
              ? "File not reached by internal import-graph fallback (conservative)."
              : "File is not referenced by import graph or framework entry points.",
          source,
          confidenceReason: routeLike
            ? "Route-like path protected from deletion."
            : "No inbound imports detected and file is not a protected entry point.",
          evidence: makeEvidence("Unused file candidate", [
            `path=${rel}`,
            `inboundImports=${inboundImports}`,
            `routeLike=${routeLike}`,
            `analyzer=${source}`,
          ]),
        })
      );
    }

    const depList = [...(issue.dependencies ?? []), ...(issue.devDependencies ?? [])];
    for (const dep of depList) {
      if (!dep.name || seenDeps.has(dep.name)) continue;
      seenDeps.add(dep.name);
      dependencies.push(
        makeFinding({
          type: "unused_dependency",
          title: "Unused dependency",
          files: [issue.file === "package.json" ? "package.json" : issue.file],
          packageName: dep.name,
          confidence: 0.84,
          reason:
            source === "knip_fallback"
              ? "Package not found in import statements (import-graph fallback)."
              : "Package is listed in package.json but no usage was found.",
          source,
          confidenceReason: "Package name not referenced in scanned import graph.",
          evidence: makeEvidence("Unused dependency candidate", [
            `package=${dep.name}`,
            `declaredIn=${issue.file}`,
            `analyzer=${source}`,
          ]),
        })
      );
    }

    for (const exp of issue.exports ?? []) {
      const key = `${issue.file}::${exp.name}`;
      if (seenExports.has(key)) continue;
      seenExports.add(key);
      const rel = normalizeRepoPath(rootDir, issue.file);
      exports.push(
        makeFinding({
          type: "unused_export",
          title: `Unused export: ${exp.name}`,
          files: [rel],
          confidence: 0.7,
          reason: `Export "${exp.name}" appears unused in the module graph.`,
          source,
          confidenceReason: "Export symbol not referenced by import graph scan.",
          evidence: makeEvidence("Unused export candidate", [
            `file=${rel}`,
            `export=${exp.name}`,
            `analyzer=${source}`,
          ]),
        })
      );
    }
  }

  return { files, dependencies, exports };
}

function fromJscpd(report: JscpdRawReport | null, rootDir: string, source: FindingSource) {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const dup of report?.duplicates ?? []) {
    const a = dup.firstFile?.name ? normalizeRepoPath(rootDir, dup.firstFile.name) : null;
    const b = dup.secondFile?.name ? normalizeRepoPath(rootDir, dup.secondFile.name) : null;
    if (!a || !b) continue;
    const key = [a, b].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);

    const dupLines = dup.lines ?? 4;
    const confidence = clampConfidence(0.75 + Math.min(dupLines / 100, 0.2));

    findings.push(
      makeFinding({
        type: "duplicate_code",
        title: "Duplicate code cluster",
        files: [a, b],
        lines: dup.firstFile
          ? { start: dup.firstFile.start, end: dup.firstFile.end }
          : undefined,
        confidence,
        action: "review_first",
        reason:
          source === "jscpd_fallback"
            ? "Similar normalized line chunks detected (internal fallback detector)."
            : "Similar logic appears in multiple files.",
        source,
        confidenceReason: `Duplicate similarity based on ${dupLines} matched lines across ${a} and ${b}.`,
        evidence: makeEvidence("Duplicate code cluster", [
          `files=${a},${b}`,
          `matchedLines=${dupLines}`,
          `analyzer=${source}`,
        ]),
      })
    );
  }

  return findings;
}

function fromMadge(report: MadgeRawReport | null, rootDir: string, source: FindingSource) {
  const findings: Finding[] = [];

  for (const orphan of report?.orphans ?? []) {
    const rel = normalizeRepoPath(rootDir, orphan);
    if (isDoNotTouchPath(rel)) continue;
    if (isRouteLikePath(rel)) continue;

    findings.push(
      makeFinding({
        type: "orphan_pattern",
        title: "Disconnected module",
        files: [rel],
        confidence: 0.68,
        reason:
          source === "madge_fallback"
            ? "File not reached from entry points (import-graph fallback)."
            : "File is not reached from detected app entry points in the dependency graph.",
        source,
        confidenceReason: "No inbound path from detected entry points.",
        evidence: makeEvidence("Orphan module", [
          `path=${rel}`,
          `analyzer=${source}`,
        ]),
      })
    );
  }

  for (const cycle of report?.circular ?? []) {
    const files = cycle.map((f) => normalizeRepoPath(rootDir, f));
    findings.push(
      makeFinding({
        type: "orphan_pattern",
        title: "Circular dependency cluster",
        files,
        confidence: 0.74,
        action: "review_first",
        reason: "Circular imports detected — refactor before deletion.",
        source,
        confidenceReason: `Circular dependency chain length ${files.length}.`,
        evidence: makeEvidence("Circular dependency cluster", [
          `files=${files.join(",")}`,
          `analyzer=${source}`,
        ]),
      })
    );
  }

  return findings;
}

function fromSlop(signals: SlopRawSignal[]): Finding[] {
  return signals.map((s) =>
    makeFinding({
      type: "ai_slop_signal",
      title: s.title,
      files: s.files,
      confidence: s.confidence,
      action: classifyAction(s.files, {
        type: "ai_slop_signal",
        forceReview: !s.files.every((f) => /(archive|backup|old|unused|tmp)/i.test(f)),
      }),
      reason: s.reason,
      source: "heuristic",
      confidenceReason: s.reason,
      evidence: makeEvidence("AI-slop heuristic signal", [
        `title=${s.title}`,
        `files=${s.files.join(",")}`,
      ]),
    })
  );
}

function buildRiskBuckets(all: Finding[]) {
  const safeDelete: string[] = [];
  const reviewFirst: string[] = [];
  const doNotTouch: string[] = [];

  for (const f of all) {
    if (f.action === "safe_candidate") safeDelete.push(f.id);
    else if (f.action === "do_not_touch") doNotTouch.push(f.id);
    else reviewFirst.push(f.id);
  }

  return { safeDelete, reviewFirst, doNotTouch };
}

function buildSummary(
  duplicates: Finding[],
  unusedFiles: Finding[],
  unusedDeps: Finding[],
  unusedExports: Finding[],
  orphans: Finding[],
  slop: Finding[]
): FindingsSummary {
  return buildSummaryFromFindings([
    ...duplicates,
    ...unusedFiles,
    ...unusedDeps,
    ...unusedExports,
    ...orphans,
    ...slop,
  ]);
}

function toToolReport<T>(result: AnalyzerRunResult<T>, command: string): ToolRunReport {
  return {
    status: result.status,
    source: result.source,
    sourceMode: result.sourceMode,
    version: result.version,
    diagnosticId: result.error ? `diag_${result.source ?? "tool"}_${result.status}` : undefined,
    error: result.error,
    durationMs: result.durationMs,
    command,
    exitCode:
      result.status === "ok" && result.sourceMode === "native"
        ? 0
        : result.status === "failed"
          ? 1
          : null,
  };
}

export function normalizeFindings(input: NormalizeInput): FindingsPayload {
  const knipFindings =
    input.knip && input.knipResult.status === "ok"
      ? fromKnip(input.knip, input.rootDir, "knip")
      : input.knip && input.knipResult.status === "fallback"
        ? fromKnip(input.knip, input.rootDir, "knip_fallback")
        : { files: [], dependencies: [], exports: [] };
  const duplicates =
    input.jscpd && input.jscpdResult.status === "ok"
      ? fromJscpd(input.jscpd, input.rootDir, "jscpd")
      : [];
  const orphans =
    input.madge && input.madgeResult.status === "ok"
      ? fromMadge(input.madge, input.rootDir, "madge")
      : [];
  const slopSignals = fromSlop(input.slop);

  const summary = buildSummary(
    duplicates,
    knipFindings.files,
    knipFindings.dependencies,
    knipFindings.exports,
    orphans,
    slopSignals
  );

  const payload: FindingsPayload = {
    scanId: input.scanId,
    repo: {
      owner: input.repo.owner,
      name: input.repo.name,
      branch: input.repo.branch,
      url: input.repo.url,
      commitSha: input.repo.commitSha,
    },
    mode: input.mode,
    summary,
    duplicates,
    unused: {
      files: knipFindings.files,
      dependencies: knipFindings.dependencies,
      exports: knipFindings.exports,
    },
    orphans,
    slopSignals,
    riskBuckets: buildRiskBuckets([
      ...duplicates,
      ...knipFindings.files,
      ...knipFindings.dependencies,
      ...knipFindings.exports,
      ...orphans,
      ...slopSignals,
    ]),
    artifacts: { findingsJson: true },
    rawToolReports: {
      knip: toToolReport(input.knipResult, "node node_modules/knip/bin/knip.js --reporter json --no-progress"),
      jscpd: toToolReport(input.jscpdResult, "node node_modules/jscpd/run-jscpd.js"),
      madge: toToolReport(input.madgeResult, "node scripts/madge-scan.mjs"),
    },
  };

  assertFindingsInvariants(payload);
  return payload;
}
