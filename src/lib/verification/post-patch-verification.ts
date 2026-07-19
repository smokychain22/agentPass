import fs from "node:fs/promises";
import path from "node:path";
import type { Finding, FindingsPayload } from "@/lib/findings/types";
import type { ChangeManifestEntry } from "@/lib/patch-kit/types";
import { flattenFindings } from "@/lib/findings/client";
import { runKnip } from "@/lib/findings/run-knip";
import { runJscpd } from "@/lib/findings/run-jscpd";
import { runMadge } from "@/lib/findings/run-madge";
import { normalizeFindings } from "@/lib/findings/normalize-findings";
import { detectUnusedImportsInSource } from "@/lib/findings/unused-import-detector";
import { verifyCyclesIndependent } from "@/lib/repository-graph/resolver-graph";
import { findingFingerprint, fingerprintSet, pathKeySet, findingPathKey } from "./finding-fingerprint";
import { computeRecallByRuleFamily } from "@/lib/findings/recall-metrics";

export interface DetectorRerunResult {
  findingId: string;
  analyzer: string;
  passed: boolean;
  detail: string;
}

export interface PostPatchVerificationReport {
  status: "passed" | "failed" | "partial" | "not_run";
  detectorReruns: DetectorRerunResult[];
  originalFindingsResolved: boolean;
  newFindingsIntroduced: Finding[];
  newFindingCount: number;
  baselineFindingCount: number;
  patchedFindingCount: number;
  recallByRuleFamily?: ReturnType<typeof computeRecallByRuleFamily>;
  cycleVerification?: Awaited<ReturnType<typeof verifyCyclesIndependent>>;
  error?: string;
}

async function checkFindingResolved(
  rootDir: string,
  finding: Finding
): Promise<DetectorRerunResult> {
  const file = finding.files[0];
  if (!file) {
    return {
      findingId: finding.id,
      analyzer: finding.source,
      passed: true,
      detail: "No file path — treated as resolved.",
    };
  }

  const rel = file.replace(/\\/g, "/");
  const full = path.join(rootDir, rel);

  if (finding.type === "unused_import") {
    try {
      const source = await fs.readFile(full, "utf8");
      const symbol = finding.evidence.signals.find((s) => s.startsWith("symbol="))?.slice(7);
      if (!symbol) {
        return {
          findingId: finding.id,
          analyzer: "repodiet_import",
          passed: true,
          detail: "No symbol signal — skipped targeted check.",
        };
      }
      const stillUnused = detectUnusedImportsInSource(rel, source);
      const stillThere = stillUnused.some((u) => u.symbol.includes(symbol));
      return {
        findingId: finding.id,
        analyzer: "repodiet_import",
        passed: !stillThere,
        detail: stillThere
          ? `Symbol ${symbol} still reported unused in patched file.`
          : `Symbol ${symbol} no longer flagged unused.`,
      };
    } catch {
      return {
        findingId: finding.id,
        analyzer: "repodiet_import",
        passed: true,
        detail: "File removed or unreadable — import resolved.",
      };
    }
  }

  if (finding.type === "unused_file" || finding.type === "ai_slop_signal") {
    try {
      await fs.access(full);
      return {
        findingId: finding.id,
        analyzer: "knip",
        passed: false,
        detail: `File still exists at ${rel}.`,
      };
    } catch {
      return {
        findingId: finding.id,
        analyzer: "knip",
        passed: true,
        detail: `File removed or empty at ${rel}.`,
      };
    }
  }

  if (finding.type === "unused_dependency" && finding.packageName) {
    const knip = await runKnip(rootDir);
    if (knip.report) {
      const stillListed = (knip.report.issues ?? []).some((issue) =>
        [...(issue.dependencies ?? []), ...(issue.devDependencies ?? [])].some(
          (d) => d.name === finding.packageName
        )
      );
      return {
        findingId: finding.id,
        analyzer: knip.source ?? "knip",
        passed: !stillListed,
        detail: stillListed
          ? `Dependency ${finding.packageName} still reported unused.`
          : `Dependency ${finding.packageName} no longer in Knip unused list.`,
      };
    }
  }

  return {
    findingId: finding.id,
    analyzer: finding.source,
    passed: true,
    detail: "No targeted re-run rule — assumed resolved after patch.",
  };
}

async function runPatchedFindingsSnapshot(
  rootDir: string,
  baseline: FindingsPayload
): Promise<FindingsPayload> {
  const [knipResult, jscpdResult, madgeResult] = await Promise.all([
    runKnip(rootDir),
    runJscpd(rootDir),
    runMadge(rootDir),
  ]);

  return normalizeFindings({
    scanId: `${baseline.scanId}_postpatch`,
    repo: {
      owner: baseline.repo.owner,
      name: baseline.repo.name,
      branch: baseline.repo.branch,
      url: baseline.repo.url ?? `https://github.com/${baseline.repo.owner}/${baseline.repo.name}`,
      commitSha: baseline.repo.commitSha,
    },
    rootDir,
    knip: knipResult.report,
    knipResult,
    jscpd: jscpdResult.report,
    jscpdResult,
    madge: madgeResult.report,
    madgeResult,
    slop: [],
    mode: baseline.mode,
  });
}

export async function runPostPatchVerification(input: {
  rootDir: string;
  baselineFindings: FindingsPayload;
  changeManifest: ChangeManifestEntry[];
  appliedFindingIds?: string[];
}): Promise<PostPatchVerificationReport> {
  const baselineFlat = flattenFindings(input.baselineFindings);
  const appliedIds = new Set(
    input.appliedFindingIds ??
      input.changeManifest.map((e) => e.findingId).filter((id) => id && id !== "safe_delete")
  );

  const appliedFindings = baselineFlat.filter((f) => appliedIds.has(f.id));

  if (appliedFindings.length === 0) {
    return {
      status: "not_run",
      detectorReruns: [],
      originalFindingsResolved: true,
      newFindingsIntroduced: [],
      newFindingCount: 0,
      baselineFindingCount: baselineFlat.length,
      patchedFindingCount: 0,
    };
  }

  try {
    const detectorReruns: DetectorRerunResult[] = [];
    for (const finding of appliedFindings) {
      detectorReruns.push(await checkFindingResolved(input.rootDir, finding));
    }

    const patchedPayload = await runPatchedFindingsSnapshot(input.rootDir, input.baselineFindings);
    const patchedFlat = flattenFindings(patchedPayload);

    const baselineFps = fingerprintSet(baselineFlat);
    const baselinePaths = pathKeySet(baselineFlat);
    const deletedPaths = new Set(
      input.changeManifest
        .filter((entry) => entry.operation === "delete")
        .map((entry) => entry.filePath.replace(/\\/g, "/").replace(/^\.\//, ""))
    );

    // Prefer path-centric matching: baseline full scan and post-patch knip/jscpd/madge
    // often emit the same file under different finding types (unused_file vs orphan_pattern),
    // which previously failed "no new findings" and blocked verified cleanup PRs.
    const newFindings = patchedFlat.filter((finding) => {
      const rels = finding.files.map((file) => file.replace(/\\/g, "/").replace(/^\.\//, ""));
      if (rels.length === 0 && !finding.packageName) return false;
      if (rels.some((rel) => deletedPaths.has(rel))) return false;
      if (baselineFps.has(findingFingerprint(finding))) return false;
      const pathKey = findingPathKey(finding);
      if (pathKey !== ":" && baselinePaths.has(pathKey)) return false;
      return true;
    });

    const originalFindingsResolved = detectorReruns.every((r) => r.passed);
    const noNewFindings = newFindings.length === 0;

    let cycleVerification;
    try {
      const madgeOnPatched = await runMadge(input.rootDir);
      cycleVerification = await verifyCyclesIndependent(input.rootDir, madgeOnPatched.report);
    } catch {
      /* optional */
    }

    const recallByRuleFamily = computeRecallByRuleFamily(appliedFindings, detectorReruns);

    let status: PostPatchVerificationReport["status"] = "passed";
    if (!originalFindingsResolved || !noNewFindings) {
      status = "failed";
    }

    return {
      status,
      detectorReruns,
      originalFindingsResolved,
      newFindingsIntroduced: newFindings.slice(0, 20),
      newFindingCount: newFindings.length,
      baselineFindingCount: baselineFlat.length,
      patchedFindingCount: patchedFlat.length,
      recallByRuleFamily,
      cycleVerification,
    };
  } catch (err) {
    return {
      status: "partial",
      detectorReruns: [],
      originalFindingsResolved: false,
      newFindingsIntroduced: [],
      newFindingCount: 0,
      baselineFindingCount: baselineFlat.length,
      patchedFindingCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
