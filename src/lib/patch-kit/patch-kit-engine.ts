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
  areRequiredPackagesInstalled,
  ensureWorkspaceDependenciesWithCache,
  inferRequiredPackagesForScripts,
} from "@/lib/execution/workspace-install";
import {
  auditTransformerCompatibleFindings,
  formatBlockerBreakdown,
  summarizeBlockers,
  summarizeCleanupAttempts,
  type CandidateAuditRecord,
  isCleanupEligibleAudit,
} from "@/lib/execution/candidate-lifecycle";
import { classifyFindingsForPatchWithDiscovery } from "./safe-delete-discovery";
import { filterFindingsBySelection } from "./filter-findings";
import { BUNDLE_FILE_COUNT } from "./bundle-manifest";
import {
  countPatchLines,
  EMPTY_CLEANUP_PATCH,
} from "./generate-cleanup-patch";
import { copyRepoBaseline } from "./generate-unified-diff";
import { ensurePatchTrailingNewline, buildPatchFromWorkspaceDelta, buildEditsFromRetainedAttempts, filterEditsAgainstBaseline, collectEditsBetweenWorkspaces } from "./merge-patches";
import { validateGeneratedPatchOnly, patchHasApplyableOperations } from "./validate-patch";
import {
  assertBaseCommitFresh,
  buildCanonicalRepositoryPatch,
  buildChangeOperationsFromEdits,
  type ChangeOperation,
} from "./canonical-patch";
import { buildApplyablePatchFromEdits } from "./applyable-patch-builder";
import { isGitCliAvailable } from "./git-runtime";
import { runRepositoryVerification } from "./repository-verification";
import { buildCleanupRunSummary } from "./cleanup-summary";
import { refreshRepositoryIdentityFromUrl, applyRepositoryIdentity } from "@/lib/github/refresh-repo-identity";
import { fetchBranchCommitSha } from "@/lib/github/fetch-repo-zip";
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
  const cleanupRunId = `patchkit_${nanoid(12)}`;

  try {
    let findings = body.findings
      ? filterFindingsBySelection(body.findings, body.selectedFindingIds)
      : await runFindingsEngine(repoUrl, branch);

    const identity = await refreshRepositoryIdentityFromUrl(repoUrl, branch);
    if (identity) {
      findings = applyRepositoryIdentity(findings, identity);
    }

    let scanCommitSha = findings.repo.commitSha ?? workspace.repo.commitSha;
    if (!scanCommitSha) {
      scanCommitSha =
        (await fetchBranchCommitSha(
          findings.repo.owner,
          findings.repo.name,
          findings.repo.branch
        )) ?? undefined;
      if (scanCommitSha) {
        findings = {
          ...findings,
          repo: { ...findings.repo, commitSha: scanCommitSha },
        };
      }
    }

    const baseCommitSha = scanCommitSha ?? workspace.repo.commitSha ?? "unknown";
    const staleCheck = assertBaseCommitFresh(scanCommitSha, workspace.repo.commitSha);
    if (staleCheck.stale) {
      const stalePayload: PatchKitPayload = {
        id: cleanupRunId,
        scanId: findings.scanId,
        repo: {
          owner: findings.repo.owner,
          name: findings.repo.name,
          branch: findings.repo.branch,
        },
        summary: {
          safeDeleteCandidates: 0,
          transformerCompatible: 0,
          dryRunPassed: 0,
          detectedFindings:
            findings.summary.detectedFindings ?? findings.summary.verifiedFindings ?? 0,
          generatedChanges: 0,
          validatedChanges: 0,
          verifiedChanges: 0,
          filesEdited: 0,
          filesDeleted: 0,
          filesAdded: 0,
          rawReviewFindings: findings.summary.reviewRequired,
          reviewFirstItems: 0,
          doNotTouchItems: findings.summary.doNotTouch ?? 0,
          packageSuggestions: findings.unused.dependencies.length,
          patchLines: 0,
          regressionChecks: 0,
          bundleFileCount: BUNDLE_FILE_COUNT,
          patchValidationStatus: "failed",
          blockerSummary: `Base commit is stale — scan: ${staleCheck.scanCommitSha?.slice(0, 7)}, current: ${staleCheck.currentCommitSha?.slice(0, 7)}.`,
        },
        patchValidation: {
          status: "failed",
          error: "BASE_COMMIT_STALE",
          userMessage: `The repository branch moved after the scan. Rescan before generating cleanup changes.\n\nScan commit: ${staleCheck.scanCommitSha}\nCurrent commit: ${staleCheck.currentCommitSha}`,
          baseCommitSha: staleCheck.scanCommitSha,
        },
        artifacts: {
          reportMd: "# RepoDiet cleanup blocked\n\nBase commit stale — rescan required.",
          cleanupPatch: EMPTY_CLEANUP_PATCH,
          packageCleanupMd: "",
          regressionChecklistMd: "",
          cursorPromptMd: "",
          findingsJson: findings,
          patchkitSummaryJson: "{}",
        },
        downloadUrl: `/api/patches/${cleanupRunId}/download`,
      };
      return stalePayload;
    }

    const context = detectRepoContextFromFindings(findings);
    const { buckets, deletionProofs } = await classifyFindingsForPatchWithDiscovery(
      workspace.rootDir,
      findings
    );

    const baselineRoot = path.join(workspace.workDir, "patch-baseline");
    await copyRepoBaseline(workspace.rootDir, baselineRoot);

    const flatFindings = flattenFindings(findings);
    const compatibleFindings = flatFindings.filter(isEligibleFinding);

    const { audits: preflightAudits } = await auditTransformerCompatibleFindings(
      workspace.rootDir,
      flatFindings
    );

    const eligibleFindingIds = preflightAudits
      .filter(isCleanupEligibleAudit)
      .map((a) => a.findingId);

    const transformerCompatible = compatibleFindings.length;
    const dryRunPassed = preflightAudits.filter(isCleanupEligibleAudit).length;

    const cleanupResult = await runFreeCleanupCore(findings, {
      maxFixes: Math.max(eligibleFindingIds.length, 1),
      findingIds: eligibleFindingIds,
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

    let generatedEdits = await filterEditsAgainstBaseline(
      baselineRoot,
      await collectEditsBetweenWorkspaces(baselineRoot, workspace.rootDir)
    );

    if (generatedEdits.length === 0) {
      const retainedEdits = buildEditsFromRetainedAttempts(cleanupResult.fixLoop.attempts);
      for (const rel of deletedPaths) {
        if (!retainedEdits.some((e) => e.path === rel)) {
          retainedEdits.push({ path: rel, content: "" });
        }
      }
      generatedEdits = await filterEditsAgainstBaseline(baselineRoot, retainedEdits);
    }

    let patchBundle = { patch: EMPTY_CLEANUP_PATCH, changedPaths: [] as string[], edits: generatedEdits };
    let patchGenerationMethod: "git-cli" | "pure-js" | undefined;
    let gitCliAvailable: boolean | undefined;

    if (generatedEdits.length > 0) {
      const canonical = await buildCanonicalRepositoryPatch(
        baselineRoot,
        generatedEdits,
        workspace.workDir
      );
      patchGenerationMethod = canonical.method;
      gitCliAvailable = canonical.gitCliAvailable;
      if (patchHasApplyableOperations(canonical.patch)) {
        patchBundle = { ...canonical, edits: generatedEdits };
      } else {
        const pure = await buildApplyablePatchFromEdits(baselineRoot, generatedEdits);
        if (patchHasApplyableOperations(pure.patch)) {
          patchGenerationMethod = "pure-js";
          patchBundle = { patch: pure.patch, changedPaths: pure.changedPaths, edits: generatedEdits };
        } else {
          patchBundle = await buildPatchFromWorkspaceDelta(
            baselineRoot,
            workspace.rootDir,
            workspace.workDir
          );
          if (patchBundle.edits.length === 0) {
            patchBundle.edits = generatedEdits;
          }
        }
      }
    }

    const protectedPaths = [
      ...(findings.riskBuckets?.doNotTouch ?? []),
      ...buckets.doNotTouch.map((item) => item.path),
    ];

    const changeOperations: ChangeOperation[] = await buildChangeOperationsFromEdits(
      baselineRoot,
      generatedEdits
    );

    const generatedChanges = generatedEdits.length;
    const changedPaths = generatedEdits.map((e) => e.path);
    let mergedPatch =
      patchBundle.patch && patchBundle.patch !== EMPTY_CLEANUP_PATCH
        ? ensurePatchTrailingNewline(patchBundle.patch)
        : EMPTY_CLEANUP_PATCH;

    const transformerResults = buildTransformerResults(
      compatibleFindings,
      candidateAudits,
      cleanupResult.fixLoop.attempts
    );

    let patchValidation: PatchKitPayload["patchValidation"];

    if (generatedEdits.length === 0 && retainedFixCount === 0 && safeDeleteCount === 0) {
      patchValidation = {
        status: "not_generated",
        error:
          cleanupResult.blockerBreakdown ??
          "No patch diff was generated — no source modifications passed dry-run and validation.",
      };
    } else if (
      patchHasApplyableOperations(mergedPatch) &&
      mergedPatch !== EMPTY_CLEANUP_PATCH
    ) {
      patchValidation = await validateGeneratedPatchOnly(baselineRoot, mergedPatch, {
        cleanupRunId,
        repository: `${findings.repo.owner}/${findings.repo.name}`,
        baseCommitSha,
        workDir: workspace.workDir,
        expectedOperations: changeOperations,
        protectedPaths,
      });
      if (patchValidation && patchGenerationMethod) {
        patchValidation = {
          ...patchValidation,
          patchGenerationMethod,
          gitCliAvailable,
        };
      }
    } else if (generatedEdits.length > 0) {
      const gitAvailable = await isGitCliAvailable();
      patchValidation = {
        status: "failed",
        error: "Generated edits did not produce an applyable unified patch.",
        userMessage: [
          "Generated file operations did not produce a Git-applyable patch.",
          gitAvailable
            ? "Git is available but patch generation failed — see Developer Tools."
            : "Git CLI is unavailable in this runtime; pure-JS patch builder also failed.",
          `Edits: ${generatedEdits.length}, paths: ${generatedEdits.map((e) => e.path).join(", ")}`,
        ].join("\n"),
      };
    } else {
      patchValidation = {
        status: "not_generated",
        error: cleanupResult.blockerBreakdown ?? "No applyable patch operations.",
      };
    }

    let validatedEdits: typeof generatedEdits = [];
    let validatedChanges = 0;
    let verifiedChanges = 0;

    if (patchValidation?.status === "passed" && generatedEdits.length > 0) {
      validatedEdits = generatedEdits;
      validatedChanges = generatedEdits.length;
    }

    if (patchValidation?.status === "passed") {
      try {
        const pkgRaw = await fs.readFile(path.join(workspace.rootDir, "package.json"), "utf8");
        const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
        const requiredPackages = inferRequiredPackagesForScripts(pkg.scripts ?? {});
        if (!(await areRequiredPackagesInstalled(workspace.rootDir, requiredPackages))) {
          await ensureWorkspaceDependenciesWithCache(workspace.rootDir, cleanupRunId);
        }
      } catch {
        /* no package.json — verification will skip install */
      }
    }

    const repositoryVerification =
      patchValidation?.status === "passed"
        ? await runRepositoryVerification({
            baselineRoot,
            edits: validatedEdits.length > 0 ? validatedEdits : generatedEdits,
            cleanupRunId,
            patch: mergedPatch,
            patchedRoot: workspace.rootDir,
          })
        : {
            status: "not_run" as const,
            installAttempts: [],
            checks: [],
          };

    if (repositoryVerification.status === "verified" && validatedChanges > 0) {
      verifiedChanges = validatedChanges;
    }

    const deliveryReady =
      patchValidation?.status === "passed" &&
      validatedChanges > 0 &&
      repositoryVerification.status === "verified";

    const filesEdited = validatedEdits.filter((e) => e.content !== "").length || generatedEdits.filter((e) => e.content !== "").length;
    const filesDeleted = deletedPaths.length;
    const filesAdded = 0;
    const blockerBreakdown = summarizeBlockers(candidateAudits);
    const attemptStats = summarizeCleanupAttempts(candidateAudits);
    const detectedFindings =
      findings.summary.detectedFindings ?? findings.summary.verifiedFindings ?? flatFindings.length;
    const packageCleanupMd = generatePackageCleanup(findings, context.packageManager);
    const { markdown: regressionChecklistMd, checkCount } = generateRegressionChecklist(
      context,
      context.packageManager
    );
    const blockerSummary = deliveryReady
      ? `${verifiedChanges} verified file operation(s) ready for cleanup PR (${generatedChanges} generated, ${validatedChanges} patch-validated).`
      : patchValidation?.status === "passed" && repositoryVerification.status === "blocked"
        ? `${generatedChanges} generated file operation(s); patch validation passed; repository verification blocked — ${repositoryVerification.error ?? "dependency installation failed"}.`
        : patchValidation?.userMessage ??
          patchValidation?.error ??
          repositoryVerification.error ??
          cleanupResult.blockerBreakdown ??
          formatBlockerBreakdown(candidateAudits);

    const id = cleanupRunId;
    const summary: PatchKitSummary = {
      safeDeleteCandidates: safeDeleteCount,
      supportedFixesDetected: transformerCompatible,
      transformerCompatible,
      dryRunPassed,
      detectedFindings,
      preflightCheckedFindings: attemptStats.preflightChecked || flatFindings.length,
      eligibleFindings: attemptStats.eligible,
      ineligibleFindings: attemptStats.ineligible,
      executedFindings: attemptStats.executed,
      attemptedTransformations: attemptStats.executed,
      noopTransformations: attemptStats.noop,
      noOpExecutions: attemptStats.noop,
      failedTransformations: attemptStats.failed,
      failedExecutions: attemptStats.failedExecutions,
      notAttempted: attemptStats.notAttempted,
      generatedChanges,
      generatedFileOperations: generatedChanges,
      validatedChanges,
      validatedFileOperations: validatedChanges,
      verifiedChanges,
      verifiedFileOperations: verifiedChanges,
      deliveredFileOperations: 0,
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
      patchValidationStatus: patchValidation?.status,
      deletedPaths,
      changedPaths,
      blockerBreakdown,
      blockerSummary,
    };

    summary.proofLadder = buildProofLadderCounts({
      findings,
      summary,
      verificationStatus:
        repositoryVerification.status === "verified"
          ? "passed"
          : repositoryVerification.status === "blocked"
            ? "partial"
            : repositoryVerification.status === "failed"
              ? "failed"
              : "pending",
    });

    const cleanupRunSummary = buildCleanupRunSummary({
      findings,
      summary,
      candidateAudits,
      verification: repositoryVerification,
    });
    summary.proofLadder = {
      ...summary.proofLadder,
      eligible: cleanupRunSummary.eligible,
      executed: cleanupRunSummary.executed,
      attempted: cleanupRunSummary.executed,
      generated: cleanupRunSummary.generated,
      validated: cleanupRunSummary.validated,
      verified: cleanupRunSummary.verified,
      delivered: cleanupRunSummary.delivered,
      noop: cleanupRunSummary.noOp,
      failed: cleanupRunSummary.failed,
      notAttempted: cleanupRunSummary.notAttempted,
      rejectedForSafety: cleanupRunSummary.reviewRequired + cleanupRunSummary.protected,
    };

    const cursorPromptMd = generateCursorPrompt(findings, buckets, context);
    const reportMd = generateReport(findings, buckets, context);

    const { added: linesAdded, removed: linesRemoved } = countDiffLines(mergedPatch);

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
      changeOperations,
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
        verificationStatus:
          repositoryVerification.status === "verified"
            ? "passed"
            : repositoryVerification.status === "blocked"
              ? "partial"
              : repositoryVerification.status === "failed"
                ? "failed"
                : "pending",
      }),
      repositoryVerification: {
        status: repositoryVerification.status,
        failureCode: repositoryVerification.failureCode,
        error: repositoryVerification.error,
        installAttempts: repositoryVerification.installAttempts,
        checks: repositoryVerification.checks,
      },
      cleanupRunSummary,
      deletionProofs,
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
