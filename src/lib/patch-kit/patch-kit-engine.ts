import { nanoid } from "nanoid";
import { runFindingsEngine } from "@/lib/findings/findings-engine";
import { runBasicScan } from "@/lib/scanner/run-scan";
import type { FindingsPayload } from "@/lib/findings/types";
import { classifyFindingsForPatch } from "./safe-delete-classifier";
import { generateCleanupPatch, countPatchLines } from "./generate-cleanup-patch";
import { generatePackageCleanup } from "./generate-package-cleanup";
import {
  detectRepoContextFromFindings,
  generateRegressionChecklist,
} from "./generate-regression-checklist";
import { generateCursorPrompt } from "./generate-cursor-prompt";
import { generateReport } from "./generate-report";
import { buildPatchkitSummaryJson, generateBundle } from "./generate-bundle";
import { storePatchKit } from "./patch-kit-store";
import type {
  PatchKitGenerateBody,
  PatchKitPayload,
  PatchKitRepoContext,
} from "./types";

async function resolveFindings(body: PatchKitGenerateBody): Promise<FindingsPayload> {
  if (body.findings?.scanId && body.findings?.repo?.owner) {
    return body.findings;
  }
  return runFindingsEngine(body.repoUrl, body.branch);
}

async function resolveRepoContext(
  findings: FindingsPayload,
  repoUrl: string,
  branch?: string
): Promise<PatchKitRepoContext> {
  const fromFindings = detectRepoContextFromFindings(findings);

  try {
    const scan = await runBasicScan(repoUrl, branch ?? findings.repo.branch);
    return {
      framework: scan.framework.name,
      packageManager: scan.packageManager,
      routes: mergeUnique(fromFindings.routes, pageRoutesFromScan(scan.topLevelFolders)),
      apiRoutes: fromFindings.apiRoutes,
      hasTypecheck: true,
      hasLint: true,
      hasBuild: true,
    };
  } catch {
    return fromFindings;
  }
}

function mergeUnique(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])].sort();
}

function pageRoutesFromScan(topLevelFolders: string[]): string[] {
  const routes = ["/"];
  if (topLevelFolders.includes("app")) {
    routes.push("/app", "/docs", "/okx");
  }
  return routes;
}

export async function runPatchKitEngine(body: PatchKitGenerateBody): Promise<PatchKitPayload> {
  const findings = await resolveFindings(body);
  const context = await resolveRepoContext(findings, body.repoUrl, body.branch);
  const buckets = classifyFindingsForPatch(findings);

  const cleanupPatch = generateCleanupPatch(buckets.safeDelete);
  const packageCleanupMd = generatePackageCleanup(
    findings.unused.dependencies,
    context.packageManager
  );
  const { markdown: regressionChecklistMd, checkCount } = generateRegressionChecklist(
    context,
    context.packageManager
  );
  const cursorPromptMd = generateCursorPrompt(findings, buckets, context);
  const reportMd = generateReport(findings, buckets, context);

  const id = `patchkit_${nanoid(12)}`;
  const summary = {
    safeDeleteCandidates: buckets.safeDelete.length,
    reviewFirstItems: buckets.reviewFirst.length,
    doNotTouchItems: buckets.doNotTouch.length,
    packageSuggestions: findings.unused.dependencies.length,
    patchLines: countPatchLines(cleanupPatch),
    regressionChecks: checkCount,
  };

  const patchkitSummaryJson = buildPatchkitSummaryJson(id, findings.repo, summary);

  const bundle = await generateBundle(findings.repo.name, findings.repo.branch, {
    reportMd,
    cleanupPatch,
    packageCleanupMd,
    regressionChecklistMd,
    cursorPromptMd,
    findingsJson: findings,
    patchkitSummaryJson,
  });

  const payload: PatchKitPayload = {
    id,
    repo: {
      owner: findings.repo.owner,
      name: findings.repo.name,
      branch: findings.repo.branch,
    },
    summary,
    artifacts: {
      reportMd,
      cleanupPatch,
      packageCleanupMd,
      regressionChecklistMd,
      cursorPromptMd,
      findingsJson: findings,
      patchkitSummaryJson,
    },
    downloadUrl: `/api/patch-kit/download/${id}`,
    zipBase64: bundle.zipBase64,
  };

  storePatchKit(payload, bundle.zipBuffer, bundle.filename);
  return payload;
}

export async function runCleanupPatchOnly(
  body: PatchKitGenerateBody
): Promise<{ cleanupPatch: string; safeDeleteCandidates: number }> {
  const findings = await resolveFindings(body);
  const buckets = classifyFindingsForPatch(findings);
  const cleanupPatch = generateCleanupPatch(buckets.safeDelete);
  return {
    cleanupPatch,
    safeDeleteCandidates: buckets.safeDelete.length,
  };
}

export async function runRegressionChecklistOnly(
  body: PatchKitGenerateBody
): Promise<{ regressionChecklistMd: string; regressionChecks: number }> {
  const findings = await resolveFindings(body);
  const context = await resolveRepoContext(findings, body.repoUrl, body.branch);
  const { markdown, checkCount } = generateRegressionChecklist(
    context,
    context.packageManager
  );
  return {
    regressionChecklistMd: markdown,
    regressionChecks: checkCount,
  };
}
