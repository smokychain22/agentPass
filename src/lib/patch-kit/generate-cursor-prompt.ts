import type { FindingsPayload } from "@/lib/findings/types";
import type { ClassifiedBuckets } from "./types";
import type { PatchKitRepoContext } from "./types";

export function generateCursorPrompt(
  findings: FindingsPayload,
  buckets: ClassifiedBuckets,
  context: PatchKitRepoContext
): string {
  const repoUrl =
    findings.repo.url ??
    `https://github.com/${findings.repo.owner}/${findings.repo.name}`;

  const safeList =
    buckets.safeDelete.length > 0
      ? buckets.safeDelete.map((i) => `- \`${i.path}\` — ${i.reason}`).join("\n")
      : "- (none)";

  const reviewList =
    buckets.reviewFirst.length > 0
      ? buckets.reviewFirst
          .slice(0, 40)
          .map((i) => `- \`${i.path}\` — ${i.reason}`)
          .join("\n")
      : "- (none)";

  const doNotTouchList =
    buckets.doNotTouch.length > 0
      ? buckets.doNotTouch
          .slice(0, 40)
          .map((i) => `- \`${i.path}\` — ${i.reason}`)
          .join("\n")
      : "- (none)";

  return `# Cursor Cleanup Prompt

You are cleaning a JavaScript/TypeScript repo using RepoDiet findings.

## Rules
- Do not delete framework routes, layouts, API routes, config files, env files, lockfiles, or public assets without confirmation.
- Start with safe candidates only.
- For Review First items, inspect imports and runtime usage before changing.
- After every cleanup batch, run lint and build.
- Preserve app behavior.

## Repo
- URL: ${repoUrl}
- Branch: ${findings.repo.branch}
- Framework: ${context.framework}
- Package manager: ${context.packageManager}

## Findings summary
- Duplicate clusters: ${findings.summary.duplicateClusters}
- Unused files: ${findings.summary.unusedFiles}
- Unused dependencies: ${findings.summary.unusedDependencies}
- Orphan patterns: ${findings.summary.orphanPatterns}
- AI-slop signals: ${findings.summary.slopSignals}
- Safe candidates: ${buckets.safeDelete.length}
- Review first: ${buckets.reviewFirst.length}
- Do not touch: ${buckets.doNotTouch.length}

## Safe candidates
${safeList}

## Review first
${reviewList}

## Do not touch
${doNotTouchList}

## Task
Create a conservative cleanup PR that removes only safe files first, then proposes review changes separately.
`;
}
