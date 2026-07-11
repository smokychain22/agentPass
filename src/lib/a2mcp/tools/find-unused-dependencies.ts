import { runFindingsCategory } from "@/lib/findings/findings-engine";
import { FALLBACK_DEPENDENCY_WARNING } from "@/lib/a2mcp/constants";
import { ToolInputSchemas } from "@/lib/a2mcp/schemas";

export async function executeFindUnusedDependencies(body: unknown) {
  const input = ToolInputSchemas.repoOnly(body);
  const findings = await runFindingsCategory(input.repoUrl, input.branch, "unused_dependencies");
  const warnings: string[] = [];

  const isFallback =
    findings.rawToolReports.knip.status === "fallback" ||
    findings.unused.dependencies.some((d) => d.source === "knip_fallback");

  if (isFallback) {
    warnings.push(FALLBACK_DEPENDENCY_WARNING);
  }

  const dependencies = findings.unused.dependencies.map((dep) => ({
    packageName: dep.packageName ?? "unknown",
    dependencyType: "dependencies" as const,
    confidence: dep.confidence,
    action: dep.action,
    reason: dep.reason,
    source: dep.source,
  }));

  return {
    data: {
      repo: {
        owner: findings.repo.owner,
        name: findings.repo.name,
        branch: findings.repo.branch,
      },
      summary: {
        unusedDependencies: findings.summary.unusedDependencies,
        source: isFallback ? "fallback" : "knip",
        confidencePolicy: "review_before_removing" as const,
      },
      dependencies,
      ...(isFallback ? { warning: FALLBACK_DEPENDENCY_WARNING } : {}),
    },
    warnings,
  };
}
