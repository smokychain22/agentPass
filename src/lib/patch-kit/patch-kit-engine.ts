import { nanoid } from "nanoid";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { runFindingsEngine } from "@/lib/findings/findings-engine";
import { runBasicScan } from "@/lib/scanner/run-scan";
import type { FindingsPayload } from "@/lib/findings/types";
import { isAutoFixEligible } from "@/lib/cleanup/eligibility";
import { runFreeCleanupCore } from "@/lib/execution/run-cleanup-core";
import { QUICK_CLEANUP_RETAINED_FIX_LIMIT } from "@/lib/execution/constants";
import { classifyFindingsForPatch } from "./safe-delete-classifier";
import { filterFindingsBySelection } from "./filter-findings";
import { BUNDLE_FILE_COUNT } from "./bundle-manifest";
import {
  countPatchLines,
  finalizeCleanupPatch,
  EMPTY_CLEANUP_PATCH,
} from "./generate-cleanup-patch";
import { generateUnifiedDeletePatch } from "./generate-unified-diff";
import { mergeCleanupPatches } from "./merge-patches";
import { validateCleanupPatchInWorkspace, patchHasApplyableOperations } from "./validate-patch";
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
  ChangeManifestEntry,
  PatchKitGenerateBody,
  PatchKitPayload,
  PatchKitRepoContext,
  TransformerResult,
} from "./types";
import { createHash } from "node:crypto";
import { supportedTransformerFor } from "@/lib/workflow/lifecycle";

async function resolveFindings(body: PatchKitGenerateBody): Promise<FindingsPayload> {
  if (body.findings?.scanId && body.findings?.repo?.owner) {
    return filterFindingsBySelection(body.findings, body.selectedFindingIds);
  }
  const full = await runFindingsEngine(body.repoUrl, body.branch);
  return filterFindingsBySelection(full, body.selectedFindingIds);
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
      hasTypecheck: Boolean(scan.configFiles.some((c) => c.includes("tsconfig"))),
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

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function buildTransformerResults(
  supportedFindings: import("@/lib/findings/types").Finding[],
  attempts: Array<{
    findingId: string;
    status: string;
    displayReason: string;
    pluginId: string;
    changedPaths: string[];
    originalSources: Record<string, string>;
    modifiedSources: Record<string, string>;
  }>
): TransformerResult[] {
  const byFindingId = new Map(attempts.map((a) => [a.findingId, a]));
  return supportedFindings.map((finding) => {
    const transformer = supportedTransformerFor(finding) ?? finding.supportedTransformer ?? "unknown";
    const attempt = byFindingId.get(finding.id);
    const filePath = finding.files[0];
    if (!attempt) {
      return {
        findingId: finding.id,
        transformer,
        status: "skipped" as const,
        reason: "Not attempted within Quick Cleanup fix limit.",
        filePath,
      };
    }
    const hasDiff = Object.keys(attempt.modifiedSources ?? {}).length > 0;
    const original = filePath ? attempt.originalSources?.[filePath] : undefined;
    const modified = filePath ? attempt.modifiedSources?.[filePath] : undefined;
    if (attempt.status === "retained" && hasDiff) {
      return {
        findingId: finding.id,
        transformer: attempt.pluginId || transformer,
        status: "generated" as const,
        reason: attempt.displayReason || "Change generated and retained.",
        filePath,
        originalHash: original ? hashContent(original) : undefined,
        resultingDiff:
          original && modified
            ? `--- ${filePath}\n+++ ${filePath}\n(${original.length} → ${modified.length} bytes)`
            : undefined,
      };
    }
    if (hasDiff) {
      return {
        findingId: finding.id,
        transformer: attempt.pluginId || transformer,
        status: "failed" as const,
        reason: attempt.displayReason || "Change generated but not retained after validation.",
        filePath,
        originalHash: original ? hashContent(original) : undefined,
      };
    }
    return {
      findingId: finding.id,
      transformer: attempt.pluginId || transformer,
      status: "skipped" as const,
      reason: attempt.displayReason || "Transformer did not produce a patch for this finding.",
      filePath,
    };
  });
}

function pageRoutesFromScan(topLevelFolders: string[]): string[] {
  const routes = ["/"];
  if (topLevelFolders.includes("app")) {
    routes.push("/app", "/docs", "/okx");
  }
  return routes;
}

export async function runPatchKitEngine(body: PatchKitGenerateBody): Promise<PatchKitPayload> {
  const repoUrl =
    body.repoUrl ||
    (body.findings
      ? `https://github.com/${body.findings.repo.owner}/${body.findings.repo.name}`
      : "");
  const branch = body.branch ?? body.findings?.repo.branch;

  const workspace = await prepareRepoWorkspace(repoUrl, branch);

  try {
    const findings = body.findings
      ? filterFindingsBySelection(body.findings, body.selectedFindingIds)
      : await runFindingsEngine(repoUrl, branch);

    const context = detectRepoContextFromFindings(findings);
    const buckets = classifyFindingsForPatch(findings);

    const { patch: rawPatch, deletedPaths } = await generateUnifiedDeletePatch(
      workspace.rootDir,
      buckets.safeDelete
    );

    const safeDeleteCount = deletedPaths.length;
    const flatFindings = [
      ...findings.duplicates,
      ...findings.unused.files,
      ...findings.unused.dependencies,
      ...findings.unused.exports,
      ...findings.orphans,
      ...findings.slopSignals,
    ];
    const supportedFindings = flatFindings.filter(isAutoFixEligible);
    const supportedFixesDetected = supportedFindings.length;

    const cleanupResult = await runFreeCleanupCore(findings, {
      maxFixes: QUICK_CLEANUP_RETAINED_FIX_LIMIT,
      workspaceRootDir: workspace.rootDir,
      quickPatchMode: true,
    });
    const fixDiff = cleanupResult.unifiedDiff?.trim() ?? "";
    const generatedChanges = cleanupResult.fixLoop.attempts.filter(
      (a) => Object.keys(a.modifiedSources ?? {}).length > 0
    ).length;
    const validatedChanges = cleanupResult.metrics.issuesChanged;
    const changedPaths = cleanupResult.proof.changedFiles;
    const transformerResults = buildTransformerResults(
      supportedFindings,
      cleanupResult.fixLoop.attempts
    );

    const validatedEdits: Array<{ path: string; content: string }> = [];
    for (const attempt of cleanupResult.fixLoop.attempts) {
      if (attempt.status !== "retained") continue;
      for (const [rel, content] of Object.entries(attempt.modifiedSources ?? {})) {
        validatedEdits.push({ path: rel, content });
      }
    }

    const deletePatch = safeDeleteCount > 0 ? rawPatch : "";
    const cleanupPatch = finalizeCleanupPatch(
      safeDeleteCount,
      deletePatch,
      fixDiff || undefined
    );
    const mergedPatch =
      deletePatch && fixDiff ? mergeCleanupPatches(deletePatch, fixDiff) : cleanupPatch;

    let patchValidation: { status: "passed" | "failed" | "skipped" | "not_generated"; error?: string };
    if (
      !patchHasApplyableOperations(mergedPatch) ||
      mergedPatch === EMPTY_CLEANUP_PATCH
    ) {
      patchValidation = {
        status: "not_generated",
        error: "No patch diff was generated.",
      };
    } else {
      patchValidation = await validateCleanupPatchInWorkspace(workspace.rootDir, mergedPatch);
    }

    const filesEdited = changedPaths.length;
    const filesDeleted = deletedPaths.length;
    const filesAdded = 0;

    const packageCleanupMd = generatePackageCleanup(findings, context.packageManager);
    const { markdown: regressionChecklistMd, checkCount } = generateRegressionChecklist(
      context,
      context.packageManager
    );
    const cursorPromptMd = generateCursorPrompt(findings, buckets, context);
    const reportMd = generateReport(findings, buckets, context);

    const id = `patchkit_${nanoid(12)}`;
    const summary = {
      safeDeleteCandidates: safeDeleteCount,
      supportedFixesDetected,
      generatedChanges,
      validatedChanges,
      verifiedChanges: 0,
      filesEdited,
      filesDeleted,
      filesAdded,
      rawReviewFindings: findings.summary.reviewRequired,
      reviewFirstItems: buckets.reviewFirst.length,
      doNotTouchItems: buckets.doNotTouch.length,
      packageSuggestions: findings.unused.dependencies.length,
      patchLines: countPatchLines(mergedPatch),
      regressionChecks: checkCount,
      bundleFileCount: BUNDLE_FILE_COUNT,
      patchValidationStatus: patchValidation.status,
      deletedPaths,
      changedPaths,
    };

    const patchkitSummaryJson = buildPatchkitSummaryJson(id, findings.repo, summary);

    const bundle = await generateBundle(findings.repo.name, findings.repo.branch, {
      reportMd,
      cleanupPatch: mergedPatch,
      packageCleanupMd,
      regressionChecklistMd,
      cursorPromptMd,
      findingsJson: findings,
      patchkitSummaryJson,
    });

    const changeManifest: ChangeManifestEntry[] = cleanupResult.fixLoop.attempts
      .filter((a) => a.status === "retained")
      .flatMap((a) =>
        a.changedPaths.map((path) => ({
          findingId: a.findingId,
          transformationType: a.pluginId,
          filePath: path,
          operation: "edit" as const,
        }))
      );
    deletedPaths.forEach((path) => {
      changeManifest.push({
        findingId: "safe_delete",
        transformationType: "file_deletion",
        filePath: path,
        operation: "delete",
      });
    });

    const payload: PatchKitPayload = {
      id,
      scanId: findings.scanId,
      repo: {
        owner: findings.repo.owner,
        name: findings.repo.name,
        branch: findings.repo.branch,
      },
      summary,
      patchValidation,
      transformerResults,
      artifacts: {
        reportMd,
        cleanupPatch: mergedPatch,
        packageCleanupMd,
        regressionChecklistMd,
        cursorPromptMd,
        findingsJson: findings,
        patchkitSummaryJson,
      },
      downloadUrl: `/api/patches/${id}/download`,
      zipBase64: bundle.zipBase64,
      validatedEdits: validatedEdits.length > 0 ? validatedEdits : undefined,
      changeManifest,
    };

    await storePatchKit(payload, bundle.zipBuffer, bundle.filename, findings.scanId);
    return payload;
  } finally {
    await workspace.cleanup();
  }
}

export async function runCleanupPatchOnly(
  body: PatchKitGenerateBody
): Promise<{ cleanupPatch: string; safeDeleteCandidates: number }> {
  const result = await runPatchKitEngine(body);
  return {
    cleanupPatch: result.artifacts.cleanupPatch,
    safeDeleteCandidates: result.summary.safeDeleteCandidates,
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
