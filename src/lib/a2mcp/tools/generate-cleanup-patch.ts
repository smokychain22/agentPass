import { runPatchKitEngine } from "@/lib/patch-kit/patch-kit-engine";
import { PATCH_TOOL_POLICY } from "@/lib/a2mcp/constants";
import { ToolInputSchemas } from "@/lib/a2mcp/schemas";
import { buildRepoUrl } from "@/lib/github/parse-github-url";
import { formatProofLadderSummary } from "@/lib/execution/proof-ladder";

export async function executeGenerateCleanupPatch(body: unknown) {
  const input = ToolInputSchemas.generateCleanupPatch(body);
  const patchKit = await runPatchKitEngine({
    repoUrl: input.repoUrl,
    branch: input.branch,
  });

  const warnings: string[] = [];
  if (patchKit.summary.generatedChanges === 0) {
    warnings.push(
      "No supported source changes were generated. Review proof ladder and blocker summary before opening a cleanup PR."
    );
  }
  if (patchKit.summary.safeDeleteCandidates === 0 && patchKit.summary.generatedChanges === 0) {
    warnings.push("cleanup.patch contains no automatic delete or edit operations.");
  }

  return {
    data: {
      repo: {
        owner: patchKit.repo.owner,
        name: patchKit.repo.name,
        branch: patchKit.repo.branch,
        url: buildRepoUrl(patchKit.repo.owner, patchKit.repo.name),
        commitSha: patchKit.artifacts.findingsJson.repo.commitSha ?? null,
      },
      scanId: patchKit.scanId,
      patchKitId: patchKit.id,
      cleanupProof: patchKit.cleanupProof,
      proofLadder: patchKit.summary.proofLadder,
      outcomeSummary: patchKit.cleanupProof
        ? formatProofLadderSummary(patchKit.cleanupProof.ladder)
        : undefined,
      summary: {
        detectedSignals: patchKit.summary.detectedSignals,
        eligibleTransformations: patchKit.summary.eligibleFindings,
        attemptedTransformations: patchKit.summary.attemptedTransformations,
        generatedChanges: patchKit.summary.generatedChanges,
        validatedChanges: patchKit.summary.validatedChanges,
        verifiedChanges: patchKit.summary.verifiedChanges,
        filesEdited: patchKit.summary.filesEdited,
        filesDeleted: patchKit.summary.filesDeleted,
        patchValidationStatus: patchKit.summary.patchValidationStatus,
        safeCandidates: patchKit.summary.safeDeleteCandidates,
        reviewFirst: patchKit.summary.reviewFirstItems,
        doNotTouch: patchKit.summary.doNotTouchItems,
      },
      artifacts: {
        repodietReportMd: patchKit.artifacts.reportMd,
        cleanupPatch: patchKit.artifacts.cleanupPatch,
        packageCleanupMd: patchKit.artifacts.packageCleanupMd,
        regressionChecklistMd: patchKit.artifacts.regressionChecklistMd,
        cursorPromptMd: patchKit.artifacts.cursorPromptMd,
        findingsJson: patchKit.artifacts.findingsJson,
        patchkitSummaryJson: JSON.parse(patchKit.artifacts.patchkitSummaryJson),
      },
      policy: PATCH_TOOL_POLICY,
      ...(input.includeZip
        ? {
            downloadUrl: patchKit.downloadUrl,
            zipBase64: patchKit.zipBase64,
          }
        : {}),
    },
    warnings,
  };
}
