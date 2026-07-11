import { runFindingsEngine } from "@/lib/findings/findings-engine";
import { classifyFindingsForPatch } from "@/lib/patch-kit/safe-delete-classifier";
import { DEAD_FILES_NOTE } from "@/lib/a2mcp/constants";
import { ToolInputSchemas } from "@/lib/a2mcp/schemas";
import type { Finding } from "@/lib/findings/types";

function formatFileFinding(finding: Finding) {
  return {
    id: finding.id,
    title: finding.title,
    files: finding.files,
    confidence: finding.confidence,
    severity: finding.severity,
    action: finding.action,
    reason: finding.reason,
    source: finding.source,
  };
}

export async function executeFindDeadFiles(body: unknown) {
  const input = ToolInputSchemas.findDeadFiles(body);
  const findings = await runFindingsEngine(input.repoUrl, input.branch);
  const buckets = classifyFindingsForPatch(findings);

  const unusedFiles = findings.unused.files.map(formatFileFinding);
  const orphans = input.includeOrphans
    ? findings.orphans.map(formatFileFinding)
    : [];

  return {
    data: {
      repo: {
        owner: findings.repo.owner,
        name: findings.repo.name,
        branch: findings.repo.branch,
      },
      summary: {
        unusedFiles: findings.summary.unusedFiles,
        orphanPatterns: input.includeOrphans ? findings.summary.orphanPatterns : 0,
        safeCandidates: buckets.safeDelete.length,
        reviewFirst: buckets.reviewFirst.length,
      },
      unusedFiles,
      orphans,
      note: DEAD_FILES_NOTE,
    },
    warnings: [] as string[],
  };
}
