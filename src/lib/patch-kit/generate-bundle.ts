import JSZip from "jszip";
import type { FindingsPayload } from "@/lib/findings/types";
import { BUNDLE_ARTIFACT_FILES } from "./bundle-manifest";
import type { PatchKitSummary } from "./types";

export interface BundleFiles {
  reportMd: string;
  cleanupPatch: string;
  packageCleanupMd: string;
  regressionChecklistMd: string;
  cursorPromptMd: string;
  findingsJson: FindingsPayload;
  patchkitSummaryJson: string;
  prEvidenceReportMd?: string;
  sarifBaselineJson?: string;
}

export interface BundleResult {
  zipBuffer: Buffer;
  zipBase64: string;
  filename: string;
}

export function bundleFilename(repoName: string, branch: string): string {
  const safeRepo = repoName.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const safeBranch = branch.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `repodiet-${safeRepo}-${safeBranch}.zip`;
}

export async function generateBundle(
  repoName: string,
  branch: string,
  files: BundleFiles
): Promise<BundleResult> {
  const zip = new JSZip();

  zip.file("repodiet-report.md", files.reportMd);
  zip.file("repodiet-cleanup.patch", files.cleanupPatch);
  zip.file("package-cleanup.md", files.packageCleanupMd);
  zip.file("regression-checklist.md", files.regressionChecklistMd);
  zip.file("cursor-prompt.md", files.cursorPromptMd);
  zip.file("findings.json", JSON.stringify(files.findingsJson, null, 2));
  zip.file("patchkit-summary.json", files.patchkitSummaryJson);
  if (files.prEvidenceReportMd) {
    zip.file("pr-evidence-report.md", files.prEvidenceReportMd);
  }
  if (files.sarifBaselineJson) {
    zip.file("findings.sarif.json", files.sarifBaselineJson);
  }

  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return {
    zipBuffer,
    zipBase64: zipBuffer.toString("base64"),
    filename: bundleFilename(repoName, branch),
  };
}

export function buildPatchkitSummaryJson(
  id: string,
  repo: { owner: string; name: string; branch: string },
  summary: PatchKitSummary
): string {
  return JSON.stringify(
    {
      id,
      generatedAt: new Date().toISOString(),
      repo,
      summary,
      countSemantics: {
        rawReviewFindings:
          "Total findings flagged review_first before path deduplication.",
        uniqueReviewItems:
          "Deduplicated files/packages documented for patch review.",
        doNotTouchItems: "Protected framework, config, route, and runtime paths.",
      },
      artifacts: [...BUNDLE_ARTIFACT_FILES],
      bundleFileCount: BUNDLE_ARTIFACT_FILES.length,
    },
    null,
    2
  );
}
