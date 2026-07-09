import { runFindingsCategory } from "@/lib/findings/findings-engine";
import type { Finding } from "@/lib/findings/types";
import { ToolInputSchemas } from "@/lib/a2mcp/schemas";

function duplicateSource(findings: Awaited<ReturnType<typeof runFindingsCategory>>): string {
  const first = findings.duplicates[0];
  if (!first) return findings.rawToolReports.jscpd === "fallback" ? "jscpd_fallback" : "jscpd";
  return first.source;
}

function formatDuplicate(finding: Finding, index: number) {
  return {
    id: `dup_${String(index + 1).padStart(3, "0")}`,
    title: finding.title,
    files: finding.files,
    confidence: finding.confidence,
    severity: finding.severity,
    action: finding.action,
    reason: finding.reason,
  };
}

export async function executeDetectDuplicateCode(body: unknown) {
  const input = ToolInputSchemas.detectDuplicateCode(body);
  const findings = await runFindingsCategory(input.repoUrl, input.branch, "duplicates");
  const duplicates = findings.duplicates.slice(0, input.limit ?? 25).map(formatDuplicate);

  return {
    data: {
      repo: {
        owner: findings.repo.owner,
        name: findings.repo.name,
        branch: findings.repo.branch,
      },
      summary: {
        duplicateClusters: findings.summary.duplicateClusters,
        source: duplicateSource(findings),
      },
      duplicates,
    },
    warnings: [] as string[],
  };
}
