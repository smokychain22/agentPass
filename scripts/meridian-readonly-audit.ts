#!/usr/bin/env tsx
/**
 * Read-only Meridian production audit (Phase 9).
 * Does NOT modify Meridian. Does NOT open a PR.
 *
 * Usage:
 *   npx tsx scripts/meridian-readonly-audit.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { MERIDIAN_PROOF } from "../src/lib/product/proof-repositories";
import { runBasicScan } from "../src/lib/scanner/run-scan";
import { runFindingsEngine } from "../src/lib/findings/findings-engine";
import { toEvidenceStandardFindings } from "../src/lib/findings/evidence-standard";
import { prepareRepoWorkspace } from "../src/lib/scanner/prepare-workspace";
import { detectPackageManager } from "../src/lib/scanner/detect-package-manager";
import { createDeepScanJob, updateDeepScanStage } from "../src/lib/deep-scan/job-store";
import { executeDeepScanJob, } from "../src/lib/deep-scan/execute";
import { claimNextDeepScanJob } from "../src/lib/deep-scan/job-store";

const OUT_DIR = path.join("/tmp/cursor/artifacts", "meridian-audit");

async function detectBaseline(rootDir: string) {
  const pm = await detectPackageManager(rootDir);
  let scripts: Record<string, string> = {};
  try {
    const raw = await fs.readFile(path.join(rootDir, "package.json"), "utf8");
    scripts = (JSON.parse(raw) as { scripts?: Record<string, string> }).scripts ?? {};
  } catch {
    scripts = {};
  }
  return {
    packageManager: pm.packageManager,
    lockfile: pm.lockfile,
    scripts: Object.keys(scripts),
    commands: {
      install: pm.packageManager === "pnpm" ? "pnpm install --frozen-lockfile" : "npm ci",
      build: scripts.build ? `${pm.packageManager === "pnpm" ? "pnpm" : "npm run"} build` : undefined,
      lint: scripts.lint ? `${pm.packageManager === "pnpm" ? "pnpm" : "npm run"} lint` : undefined,
      typecheck: scripts.typecheck
        ? `${pm.packageManager === "pnpm" ? "pnpm" : "npm run"} typecheck`
        : undefined,
      test: scripts.test ? `${pm.packageManager === "pnpm" ? "pnpm" : "npm run"} test` : undefined,
    },
    notes: [
      scripts.typecheck ? null : "No typecheck script — baseline twin-build will not claim typecheck.",
      scripts.test ? null : "No test script — baseline twin-build will not claim tests.",
    ].filter(Boolean),
  };
}

async function main() {
  console.log("=== Meridian read-only audit (no mutations) ===");
  console.log(`Repository: ${MERIDIAN_PROOF.url}`);
  console.log(`Role: ${MERIDIAN_PROOF.role}`);

  await fs.mkdir(OUT_DIR, { recursive: true });

  const deepJob = await createDeepScanJob(
    {
      repoUrl: MERIDIAN_PROOF.url,
      branch: "main",
      readOnly: true,
      requestedBy: "meridian-readonly-audit",
    },
    { idempotencyKey: `meridian-audit:${new Date().toISOString().slice(0, 13)}` }
  );
  console.log(`Deep scan job: ${deepJob.id}`);

  const claimed = await claimNextDeepScanJob("audit-runner");
  if (!claimed || claimed.id !== deepJob.id) {
    // Claim may have taken a different job; execute the audit job directly.
    await updateDeepScanStage(deepJob.id, "INVENTORY", "Audit runner starting");
  }

  const scan = await runBasicScan(MERIDIAN_PROOF.url, "main");
  console.log(
    JSON.stringify(
      {
        sourceCommit: scan.repo.commitSha,
        coverage: scan.scanCoverage?.contract,
        inventory: scan.intelligenceManifest?.inventory,
        framework: scan.framework,
        packageManager: scan.packageManager,
        projects: scan.repositoryModel?.projects,
        entryPoints: scan.intelligenceManifest?.entryPoints?.length,
      },
      null,
      2
    )
  );

  const findings = await runFindingsEngine(MERIDIAN_PROOF.url, "main");
  const evidence = toEvidenceStandardFindings(findings);

  const workspace = await prepareRepoWorkspace(MERIDIAN_PROOF.url, "main");
  let baseline;
  try {
    baseline = await detectBaseline(workspace.rootDir);
  } finally {
    await workspace.cleanup();
  }

  const highValue = evidence
    .filter((f) => f.classification !== "PROTECTED")
    .slice(0, 25)
    .map((f) => ({
      findingId: f.findingId,
      type: f.type,
      paths: f.paths,
      classification: f.classification,
      why: f.evidence.whyBelievedRemovable,
      unsafeIf: f.evidence.whatCouldMakeRemovalUnsafe,
      proposedOperations: f.proposedOperations,
    }));

  const report = {
    auditedAt: new Date().toISOString(),
    repository: MERIDIAN_PROOF.url,
    role: MERIDIAN_PROOF.role,
    mutation: "NONE — read-only audit",
    sourceCommit: scan.repo.commitSha,
    branch: scan.repo.branch,
    deepScanJobId: deepJob.id,
    coverage: scan.scanCoverage?.contract,
    inventory: scan.intelligenceManifest?.inventory,
    structure: {
      framework: scan.framework,
      packageManager: scan.packageManager,
      lockfile: scan.packageManagerLockfile,
      projects: scan.repositoryModel?.projects,
      configFiles: scan.configFiles,
      entryPoints: scan.intelligenceManifest?.entryPoints,
      packageScripts: scan.intelligenceManifest?.structure.packageScripts,
    },
    baseline,
    findingsSummary: findings.summary,
    evidenceStandardCount: evidence.length,
    highValueFindings: highValue,
    githubAppNote:
      "RepoDiet Operator must be installed on velz-cmd/Meridian before any PR delivery. Preflight currently reports not_installed.",
    nextSteps: [
      "Owner reviews high-value findings and approves exact scope",
      "Create maintenance contract binding finding IDs and budgets",
      "Install GitHub App on Meridian",
      "Execute via production worker only — Cursor must not edit Meridian",
    ],
  };

  const outFile = path.join(OUT_DIR, `meridian-readonly-${scan.repo.commitSha?.slice(0, 12) ?? "unknown"}.json`);
  await fs.writeFile(outFile, JSON.stringify(report, null, 2));
  console.log(`Wrote ${outFile}`);
  console.log(
    `Findings: total=${findings.summary.totalFindings} safe=${findings.summary.safeCandidates} review=${findings.summary.reviewRequired} protected=${findings.summary.doNotTouch}`
  );
  console.log(`Coverage: ${scan.scanCoverage?.coverageStatus}`);

  // Mark job progress for local durable store visibility (full executeDeepScanJob also available).
  await updateDeepScanStage(deepJob.id, "READY", "Read-only Meridian audit complete", {
    scanId: scan.id,
    findingsId: findings.scanId,
    sourceCommit: scan.repo.commitSha,
    repositoryOwner: scan.repo.owner,
    repositoryName: scan.repo.name,
    branch: scan.repo.branch,
    coverage: scan.scanCoverage?.contract as unknown as Record<string, unknown>,
    baseline,
    resultSummary: {
      reportPath: outFile,
      findings: findings.summary,
      highValueCount: highValue.length,
    },
  });

  // Keep executeDeepScanJob referenced for worker path smoke when NETWORK+time allow.
  void executeDeepScanJob;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
