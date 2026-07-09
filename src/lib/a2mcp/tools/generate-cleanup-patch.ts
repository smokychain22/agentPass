import { runPatchKitEngine } from "@/lib/patch-kit/patch-kit-engine";
import { PATCH_TOOL_POLICY } from "@/lib/a2mcp/constants";
import { ToolInputSchemas } from "@/lib/a2mcp/schemas";
import { buildRepoUrl } from "@/lib/github/parse-github-url";

export async function executeGenerateCleanupPatch(body: unknown) {
  const input = ToolInputSchemas.generateCleanupPatch(body);
  const patchKit = await runPatchKitEngine({
    repoUrl: input.repoUrl,
    branch: input.branch,
  });

  const warnings: string[] = [];
  if (patchKit.summary.safeDeleteCandidates === 0) {
    warnings.push(
      "No safe delete candidates were found. cleanup.patch contains no automatic delete operations."
    );
  }

  return {
    data: {
      repo: {
        owner: patchKit.repo.owner,
        name: patchKit.repo.name,
        branch: patchKit.repo.branch,
        url: buildRepoUrl(patchKit.repo.owner, patchKit.repo.name),
      },
      summary: {
        safeCandidates: patchKit.summary.safeDeleteCandidates,
        reviewFirst: patchKit.summary.reviewFirstItems,
        doNotTouch: patchKit.summary.doNotTouchItems,
        packageSuggestions: patchKit.summary.packageSuggestions,
        bundleFiles: patchKit.summary.bundleFileCount,
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
