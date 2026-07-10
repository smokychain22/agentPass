import type { FindingsPayload } from "@/lib/findings/types";
import type { ClassifiedBuckets, PatchKitRepoContext } from "./types";

function formatKeyFindings(findings: FindingsPayload, limit = 20): string {
  const all = [
    ...findings.duplicates,
    ...findings.unused.files,
    ...findings.unused.dependencies,
    ...findings.orphans,
    ...findings.slopSignals,
  ].slice(0, limit);

  if (all.length === 0) return "- No findings recorded.";

  return all
    .map((f) => {
      const target =
        f.packageName ??
        (f.files.length > 0 ? f.files.join(", ") : "(no path)");
      return `- **${f.type}** (${f.action}) \`${target}\` — ${f.reason}`;
    })
    .join("\n");
}

export function generateReport(
  findings: FindingsPayload,
  buckets: ClassifiedBuckets,
  context: PatchKitRepoContext
): string {
  const repoLabel = `${findings.repo.owner}/${findings.repo.name}`;
  const repoUrl =
    findings.repo.url ??
    `https://github.com/${findings.repo.owner}/${findings.repo.name}`;

  return `# RepoDiet Cleanup Report

## Repository

- Owner/repo: ${repoLabel}
- Branch: ${findings.repo.branch}
- URL: ${repoUrl}
- Framework: ${context.framework}
- Package manager: ${context.packageManager}

## Summary

- Duplicate clusters: ${findings.summary.duplicateClusters}
- Unused files: ${findings.summary.unusedFiles}
- Unused dependencies: ${findings.summary.unusedDependencies}
- Orphan patterns: ${findings.summary.orphanPatterns}
- AI-slop signals: ${findings.summary.slopSignals}
- Safe candidates: ${buckets.safeDelete.length}
- Raw review findings: ${findings.summary.reviewRequired}
- Unique review items: ${buckets.reviewFirst.length}
- Do not touch protected items: ${buckets.doNotTouch.length}

## Count semantics

- **Raw review findings** — total findings flagged \`review_first\` before path deduplication.
- **Unique review items** — deduplicated files/packages documented for patch review.
- **Do not touch** — protected framework, config, route, and runtime paths.

## Key findings

${formatKeyFindings(findings)}

## Patch policy

RepoDiet generated a conservative patch bundle.
No protected framework/runtime files were included in automatic delete operations.

## Next steps

1. Review Safe Candidates.
2. Apply cleanup patch.
3. Run regression checklist.
4. Re-run RepoDiet.
`;
}
