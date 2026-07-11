import { createHash } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { nanoid } from "nanoid";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { runFindingsEngine } from "@/lib/findings/findings-engine";
import { runBasicScan } from "@/lib/scanner/run-scan";
import type { Finding, FindingsPayload } from "@/lib/findings/types";
import { isEligibleFinding } from "@/lib/findings/actionability-signals";
import { runFreeCleanupCore } from "@/lib/execution/run-cleanup-core";
import {
  auditTransformerCompatibleFindings,
  formatBlockerBreakdown,
  summarizeBlockers,
  summarizeCleanupAttempts,
  type CandidateAuditRecord,
} from "@/lib/execution/candidate-lifecycle";
import { classifyFindingsForPatch } from "./safe-delete-classifier";
import { filterFindingsBySelection } from "./filter-findings";
import { BUNDLE_FILE_COUNT } from "./bundle-manifest";
import {
  countPatchLines,
  EMPTY_CLEANUP_PATCH,
} from "./generate-cleanup-patch";
import { copyRepoBaseline } from "./generate-unified-diff";
import { ensurePatchTrailingNewline, buildConsolidatedPatchFromEdits, collectEditsBetweenWorkspaces, buildEditsFromRetainedAttempts } from "./merge-patches";
import { validateCleanupPatchInWorkspace, validateEditsForDelivery, patchHasApplyableOperations } from "./validate-patch";
import { generatePackageCleanup } from "./generate-package-cleanup";
import {
  detectRepoContextFromFindings,
  generateRegressionChecklist,
} from "./generate-regression-checklist";
import { generateCursorPrompt } from "./generate-cursor-prompt";
import { generateReport } from "./generate-report";
import { buildPatchkitSummaryJson, generateBundle } from "./generate-bundle";
import { storePatchKit } from "./patch-kit-store";
import { supportedTransformerFor } from "@/lib/workflow/lifecycle";
import { buildCleanupProof, buildProofLadderCounts } from "@/lib/execution/proof-ladder";
import { countDiffLines } from "@/lib/execution/one-fix-at-a-time";
import type {
  ChangeManifestEntry,
  PatchKitGenerateBody,
  PatchKitPayload,
  PatchKitRepoContext,
  PatchKitSummary,
  TransformerResult,
} from "./types";

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

function flattenFindings(findings: FindingsPayload): Finding[] {
  return [
    ...findings.duplicates,
    ...findings.unused.files,
    ...findings.unused.dependencies,
    ...findings.unused.exports,
    ...findings.orphans,
    ...findings.slopSignals,
  ];
}

function mergeExecutionAudits(
  preflightAudits: CandidateAuditRecord[],
  executionAudits?: CandidateAuditRecord[]
): CandidateAuditRecord[] {
  if (!executionAudits?.length) return preflightAudits;
  const byId = new Map(preflightAudits.map((a) => [a.findingId, a]));
  for (const exec of executionAudits) {
    const existing = byId.get(exec.findingId);
    if (existing) {
      byId.set(exec.findingId, {
        ...existing,
        ...exec,
        scanEligible: existing.scanEligible,
        proposedSourceChanged: existing.proposedSourceChanged,
        proposedDiffGenerated: existing.proposedDiffGenerated,
        strategyIds: exec.strategyIds.length ? exec.strategyIds : existing.strategyIds,
      });
    } else {
      byId.set(exec.findingId, exec);
    }
  }
  return [...byId.values()];
}

function buildTransformerResults(
  compatibleFindings: Finding[],
  audits: CandidateAuditRecord[],
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
  const auditById = new Map(audits.map((a) => [a.findingId, a]));
  const attemptById = new Map(attempts.map((a) => [a.findingId, a]));

  return compatibleFindings.map((finding) => {
    const transformer = supportedTransformerFor(finding) ?? finding.supportedTransformer ?? "unknown";
    const audit = auditById.get(finding.id);
    const attempt = attemptById.get(finding.id);
    const filePath = finding.files[0];

    if (attempt?.status === "retained") {
      const original = filePath ? attempt.originalSources?.[filePath] : undefined;
      const modified = filePath ? attempt.modifiedSources?.[filePath] : undefined;
      return {
        findingId: finding.id,
        transformer: attempt.pluginId || transformer,
        status: "generated",
        reason: attempt.displayReason || "Change generated and retained.",
        filePath,
        originalHash: original ? hashContent(original) : undefined,
        resultingDiff:
          original && modified
            ? `--- ${filePath}\n+++ ${filePath}\n(${original.length} → ${modified.length} bytes)`
            : undefined,
      };
    }

    if (attempt && Object.keys(attempt.modifiedSources ?? {}).length > 0) {
      const original = filePath ? attempt.originalSources?.[filePath] : undefined;
      return {
        findingId: finding.id,
        transformer: attempt.pluginId || transformer,
        status: "failed",
        reason: attempt.displayReason || "Change generated but not retained after validation.",
        filePath,
        originalHash: original ? hashContent(original) : undefined,
      };
    }

    return {
      findingId: finding.id,
      transformer: audit?.pluginId ?? transformer,
      status: "skipped",
      reason:
        audit?.blockerMessage ??
        attempt?.displayReason ??
        "Transformer did not produce a patch for this finding.",
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

    const baselineRoot = path.join(workspace.workDir, "patch-baseline");
    await copyRepoBaseline(workspace.rootDir, baselineRoot);

    const flatFindings = flattenFindings(findings);
    const compatibleFindings = flatFindings.filter(isEligibleFinding);

    const { audits: preflightAudits } = await auditTransformerCompatibleFindings(
      workspace.rootDir,
      flatFindings
    );

    const transformerCompatible = compatibleFindings.length;
    const dryRunPassed = preflightAudits.filter((a) => a.scanEligible).length;

    const cleanupResult = await runFreeCleanupCore(findings, {
      maxFixes: Math.max(compatibleFindings.length, 1),
      workspaceRootDir: workspace.rootDir,
      quickPatchMode: true,
    });

    const candidateAudits = mergeExecutionAudits(
      preflightAudits,
      cleanupResult.candidateAudits
    );

    const retainedFixCount = cleanupResult.metrics.issuesChanged;

    const alreadyDeleted = new Set(
      cleanupResult.fixLoop.attempts
        .filter((a) => a.status === "retained" && a.pluginId === "remove_temp_file")
        .flatMap((a) => a.changedPaths)
    );
    const remainingSafeDeletes = buckets.safeDelete.filter((item) => !alreadyDeleted.has(item.path));

    for (const item of remainingSafeDeletes) {
      const rel = item.path.replace(/\\/g, "/").replace(/^\.\//, "");
      await fs.rm(path.join(workspace.rootDir, rel), { force: true }).catch(() => {});
    }

    const deleteScratch = path.join(workspace.workDir, "delete-scratch");
    await fs.mkdir(deleteScratch, { recursive: true });
    const deletedPaths = remainingSafeDeletes.map((item) =>
      item.path.replace(/\\/g, "/").replace(/^\.\//, "")
    );

    const safeDeleteCount = deletedPaths.length;
    const generatedChanges =
      cleanupResult.fixLoop.attempts.filter(
        (a) => Object.keys(a.modifiedSources ?? {}).length > 0
      ).length + safeDeleteCount;
    let validatedChanges = retainedFixCount + safeDeleteCount;
    let verifiedChanges = validatedChanges;
    const workspaceDeltaEdits = await collectEditsBetweenWorkspaces(baselineRoot, workspace.rootDir);
    let validatedEdits =
      workspaceDeltaEdits.length > 0
        ? workspaceDeltaEdits
        : buildEditsFromRetainedAttempts(cleanupResult.fixLoop.attempts);

    for (const rel of deletedPaths) {
      if (!validatedEdits.some((e) => e.path === rel)) {
        validatedEdits.push({ path: rel, content: "" });
      }
    }
    validatedEdits = validatedEdits.filter(
      (e, i, arr) => arr.findIndex((x) => x.path === e.path) === i
    );

    const changedPaths = validatedEdits.map((e) => e.path);

    const transformerResults = buildTransformerResults(
      compatibleFindings,
      candidateAudits,
      cleanupResult.fixLoop.attempts
    );

    let mergedPatch = EMPTY_CLEANUP_PATCH;

    if (validatedEdits.length > 0) {
      const consolidated = await buildConsolidatedPatchFromEdits(
        baselineRoot,
        validatedEdits,
        workspace.workDir
      );
      if (consolidated.patch && consolidated.patch !== EMPTY_CLEANUP_PATCH) {
        mergedPatch = ensurePatchTrailingNewline(consolidated.patch);
      }
    }

    let patchValidation: {
      status: "passed" | "failed" | "skipped" | "not_generated";
      error?: string;
    };

    if (validatedEdits.length === 0 && retainedFixCount === 0 && safeDeleteCount === 0) {
      patchValidation = {
        status: "not_generated",
        error:
          cleanupResult.blockerBreakdown ??
          "No patch diff was generated — no source modifications passed dry-run and validation.",
      };
    } else if (validatedEdits.length > 0) {
      const deliveryValidation = await validateEditsForDelivery(baselineRoot, validatedEdits);
      if (deliveryValidation.status === "passed") {
        if (patchHasApplyableOperations(mergedPatch) && mergedPatch !== EMPTY_CLEANUP_PATCH) {
          const validateRoot = path.join(workspace.workDir, "patch-validate");
          await copyRepoBaseline(baselineRoot, validateRoot);
          const gitValidation = await validateCleanupPatchInWorkspace(validateRoot, mergedPatch);
          patchValidation = gitValidation;
        } else {
          patchValidation = { status: "passed" };
        }
      } else {
        patchValidation = deliveryValidation;
      }
    } else if (!patchHasApplyableOperations(mergedPatch) || mergedPatch === EMPTY_CLEANUP_PATCH) {
      patchValidation = {
        status: "not_generated",
        error: cleanupResult.blockerBreakdown ?? "No applyable patch operations.",
      };
    } else {
      const validateRoot = path.join(workspace.workDir, "patch-validate");
      await copyRepoBaseline(baselineRoot, validateRoot);
      patchValidation = await validateCleanupPatchInWorkspace(validateRoot, mergedPatch);
    }

    const deliveryReady =
      patchValidation.status === "passed" &&
      (validatedEdits.length > 0 || safeDeleteCount > 0 || retainedFixCount > 0);

    if (!deliveryReady) {
      validatedChanges = 0;
      verifiedChanges = 0;
    } else {
      validatedChanges = validatedEdits.length;
      verifiedChanges = validatedEdits.length;
    }

    const filesEdited = validatedEdits.filter((e) => e.content !== "").length;
    const filesDeleted = deletedPaths.length;
    const filesAdded = 0;
    const blockerBreakdown = summarizeBlockers(candidateAudits);
    const attemptStats = summarizeCleanupAttempts(candidateAudits);
    const blockerSummary = deliveryReady
      ? `${validatedChanges} file change(s) validated and ready for cleanup PR (${retainedFixCount} fix attempt(s) retained${attemptStats.noop > 0 ? `, ${attemptStats.noop} no-op` : ""}).`
      : patchValidation.error ??
        cleanupResult.blockerBreakdown ??
        formatBlockerBreakdown(candidateAudits);

    const packageCleanupMd = generatePackageCleanup(findings, context.packageManager);
    const { markdown: regressionChecklistMd, checkCount } = generateRegressionChecklist(
      context,
      context.packageManager
    );
    const cursorPromptMd = generateCursorPrompt(findings, buckets, context);
    const reportMd = generateReport(findings, buckets, context);

    const { added: linesAdded, removed: linesRemoved } = countDiffLines(mergedPatch);

    const id = `patchkit_${nanoid(12)}`;
    const summary: PatchKitSummary = {
      safeDeleteCandidates: safeDeleteCount,
      supportedFixesDetected: transformerCompatible,
      transformerCompatible,
      dryRunPassed,
      detectedSignals: findings.summary.detectedFindings ?? findings.summary.verifiedFindings ?? 0,
      eligibleFindings: attemptStats.eligible,
      attemptedTransformations: attemptStats.attempted,
      noopTransformations: attemptStats.noop,
      failedTransformations: attemptStats.failed,
      notAttempted: attemptStats.notAttempted,
      generatedChanges,
      validatedChanges,
      verifiedChanges,
      retainedFixAttempts: retainedFixCount,
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
      blockerBreakdown,
      blockerSummary,
    };

    summary.proofLadder = buildProofLadderCounts({ findings, summary });

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
        a.changedPaths.map((filePath) => {
          const rel = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
          const original = a.originalSources?.[filePath] ?? a.originalSources?.[rel] ?? "";
          const modified = a.modifiedSources?.[filePath] ?? a.modifiedSources?.[rel] ?? "";
          const op: ChangeManifestEntry["operation"] =
            modified === "" && original !== "" ? "delete" : "edit";
          return {
            findingId: a.findingId,
            transformationType: a.pluginId,
            filePath: rel,
            operation: op,
            linesAdded: modified && original ? Math.max(0, modified.split("\n").length - original.split("\n").length) : undefined,
            linesRemoved: modified && original ? Math.max(0, original.split("\n").length - modified.split("\n").length) : undefined,
          };
        })
      )
      .filter((entry) => changedPaths.includes(entry.filePath));
    for (const rel of deletedPaths) {
      if (!changeManifest.some((e) => e.filePath === rel)) {
        changeManifest.push({
          findingId: "safe_delete",
          transformationType: "file_deletion",
          filePath: rel,
          operation: "delete",
        });
      }
    }

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
      candidateAudits,
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
      cleanupProof: buildCleanupProof({
        findings,
        summary,
        patchLines: { added: linesAdded, removed: linesRemoved },
        verificationStatus: "pending",
      }),
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
