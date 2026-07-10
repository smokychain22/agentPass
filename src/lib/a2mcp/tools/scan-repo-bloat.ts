import { runBasicScan } from "@/lib/scanner/run-scan";
import { runFindingsEngine } from "@/lib/findings/findings-engine";
import { classifyFindingsForPatch } from "@/lib/patch-kit/safe-delete-classifier";
import { assertFileCount } from "@/lib/a2mcp/limits";
import {
  ENV_DETECTED_WARNING,
  SCAN_POLICY,
} from "@/lib/a2mcp/constants";
import type { ScanRepoBloatInput } from "@/lib/a2mcp/schemas";
import { ToolInputSchemas } from "@/lib/a2mcp/schemas";

function analyzerStatus(findings: Awaited<ReturnType<typeof runFindingsEngine>>) {
  return {
    knip: findings.rawToolReports.knip,
    jscpd: findings.rawToolReports.jscpd,
    madge: findings.rawToolReports.madge,
    heuristics: "ok" as const,
  };
}

export async function executeScanRepoBloat(body: unknown) {
  const input: ScanRepoBloatInput = ToolInputSchemas.scanRepoBloat(body);
  const warnings: string[] = [];

  const scan = await runBasicScan(input.repoUrl, input.branch);
  assertFileCount(scan.summary.totalFiles);

  if (scan.configFiles.includes(".env") || scan.warnings.some((w) => w.includes(".env"))) {
    if (!warnings.includes(ENV_DETECTED_WARNING)) warnings.push(ENV_DETECTED_WARNING);
  }

  const findings = await runFindingsEngine(input.repoUrl, input.branch);
  const buckets = classifyFindingsForPatch(findings);

  return {
    data: {
      repo: {
        owner: scan.repo.owner,
        name: scan.repo.name,
        branch: scan.repo.branch,
        url: scan.repo.url,
      },
      scan: {
        framework: scan.framework.name,
        packageManager: scan.packageManager,
        totalFiles: scan.summary.totalFiles,
        totalFolders: scan.summary.totalFolders,
        totalSizeKb: scan.summary.totalSizeKb,
        configFiles: scan.configFiles,
      },
      findings: {
        duplicateClusters: findings.summary.duplicateClusters,
        unusedFiles: findings.summary.unusedFiles,
        unusedDependencies: findings.summary.unusedDependencies,
        orphanPatterns: findings.summary.orphanPatterns,
        aiSlopSignals: findings.summary.slopSignals,
        safeCandidates: buckets.safeDelete.length,
        rawReviewFindings: findings.summary.reviewRequired,
        uniqueReviewItems: buckets.reviewFirst.length,
        reviewFirst: buckets.reviewFirst.length,
        doNotTouch: buckets.doNotTouch.length,
      },
      analyzerStatus: analyzerStatus(findings),
      policy: SCAN_POLICY,
      mode: input.mode ?? "quick",
    },
    warnings,
  };
}
