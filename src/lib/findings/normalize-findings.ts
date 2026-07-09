import { nanoid } from "nanoid";
import type {
  Finding,
  FindingSource,
  FindingsPayload,
  FindingsSummary,
  JscpdRawReport,
  KnipRawReport,
  MadgeRawReport,
  SlopRawSignal,
  ToolStatus,
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

interface NormalizeInput {
  scanId: string;
  repo: RepoInfo;
  rootDir: string;
  knip: KnipRawReport | null;
  knipStatus: ToolStatus;
  jscpd: JscpdRawReport | null;
  jscpdStatus: ToolStatus;
  madge: MadgeRawReport | null;
  madgeStatus: ToolStatus;
  slop: SlopRawSignal[];
}

function makeFinding(
  partial: Omit<Finding, "id" | "severity" | "action"> & {
    action?: Finding["action"];
  }
): Finding {
  const files = partial.files.map((f) => f.replace(/\\/g, "/"));
  const action =
    partial.action ?? classifyAction(files, { type: partial.type, forceReview: partial.type === "duplicate_code" });
  return {
    id: `fnd_${nanoid(10)}`,
    severity: severityForAction(action),
    action,
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
      const action = isRouteLikePath(rel)
        ? "do_not_touch"
        : classifyAction([rel], { type: "unused_file" });
      files.push(
        makeFinding({
          type: "unused_file",
          title: "Unused file",
          files: [rel],
          confidence: isRouteLikePath(rel) ? 0.45 : 0.76,
          action,
          reason: isRouteLikePath(rel)
            ? "Framework route file — may be valid without direct imports."
            : source === "knip_fallback"
              ? "File not reached by internal import-graph fallback (conservative)."
              : "File is not referenced by import graph or framework entry points.",
          source,
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

    findings.push(
      makeFinding({
        type: "duplicate_code",
        title: "Duplicate code cluster",
        files: [a, b],
        lines: dup.firstFile
          ? { start: dup.firstFile.start, end: dup.firstFile.end }
          : undefined,
        confidence: clampConfidence(0.75 + Math.min((dup.lines ?? 4) / 100, 0.2)),
        action: "review_first",
        reason:
          source === "jscpd_fallback"
            ? "Similar normalized line chunks detected (internal fallback detector)."
            : "Similar logic appears in multiple files.",
        source,
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
  const all = [...duplicates, ...unusedFiles, ...unusedDeps, ...unusedExports, ...orphans, ...slop];
  return {
    duplicateClusters: duplicates.length,
    unusedFiles: unusedFiles.length,
    unusedDependencies: unusedDeps.length,
    unusedExports: unusedExports.length,
    orphanPatterns: orphans.length,
    slopSignals: slop.length,
    reviewRequired: all.filter((f) => f.action === "review_first").length,
    safeCandidates: all.filter((f) => f.action === "safe_candidate").length,
  };
}

export function normalizeFindings(input: NormalizeInput): FindingsPayload {
  const knipSource: FindingSource =
    input.knipStatus === "fallback" ? "knip_fallback" : "knip";
  const jscpdSource: FindingSource =
    input.jscpdStatus === "fallback" ? "jscpd_fallback" : "jscpd";
  const madgeSource: FindingSource =
    input.madgeStatus === "fallback" ? "madge_fallback" : "madge";

  const knipFindings =
    input.knip && input.knipStatus !== "failed"
      ? fromKnip(input.knip, input.rootDir, knipSource)
      : { files: [], dependencies: [], exports: [] };
  const duplicates =
    input.jscpd && input.jscpdStatus !== "failed"
      ? fromJscpd(input.jscpd, input.rootDir, jscpdSource)
      : [];
  const orphans =
    input.madge && input.madgeStatus !== "failed"
      ? fromMadge(input.madge, input.rootDir, madgeSource)
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

  return {
    scanId: input.scanId,
    repo: {
      owner: input.repo.owner,
      name: input.repo.name,
      branch: input.repo.branch,
      url: input.repo.url,
    },
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
      knip: input.knipStatus,
      jscpd: input.jscpdStatus,
      madge: input.madgeStatus,
    },
  };
}
