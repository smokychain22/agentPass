import { ToolExecutionError } from "@/lib/a2mcp/errors";
import { GitHubClient } from "@/lib/github/github-client";
import { hashSource } from "@/lib/execution/transform-audit";

const REPODIET_BRANCH_PREFIX = "repodiet/cleanup-";

export interface CleanupDeliveryEdit {
  path: string;
  content: string;
  baselineContentHash?: string;
}

export interface CleanupDeliveryContextResult {
  warnings: string[];
  liveBaseSha: string;
  openRepodietPullRequests: number;
  existingRepodietBranches: number;
}

function commitShaMatches(scanSha: string, liveSha: string): boolean {
  const scan = scanSha.trim().toLowerCase();
  const live = liveSha.trim().toLowerCase();
  return live === scan || live.startsWith(scan) || scan.startsWith(live);
}

export async function assertCleanupDeliveryContext(input: {
  client: GitHubClient;
  owner: string;
  repo: string;
  baseBranch: string;
  scanCommitSha?: string;
  validatedEdits: CleanupDeliveryEdit[];
}): Promise<CleanupDeliveryContextResult> {
  const warnings: string[] = [];
  const liveBaseSha = await input.client.getBranchSha(input.owner, input.repo, input.baseBranch);

  if (input.scanCommitSha?.trim()) {
    if (!commitShaMatches(input.scanCommitSha, liveBaseSha)) {
      throw new ToolExecutionError(
        "PATCH_GENERATION_FAILED",
        `Repository moved since scan (scanned ${input.scanCommitSha.slice(0, 12)}…, live ${liveBaseSha.slice(0, 12)}…). Re-scan on the current ${input.baseBranch} commit before creating a cleanup PR.`,
        409
      );
    }
  }

  for (const edit of input.validatedEdits) {
    if (!edit.baselineContentHash) continue;
    const remote = await input.client.getFileContent(input.owner, input.repo, edit.path, input.baseBranch);
    const remoteHash = hashSource(remote ?? "");
    const expectedEmpty = edit.baselineContentHash === hashSource("");
    if (remote === null && expectedEmpty) continue;
    if (remote === null) {
      throw new ToolExecutionError(
        "PATCH_GENERATION_FAILED",
        `File ${edit.path} no longer exists on ${input.baseBranch}. The scan baseline is stale — regenerate Quick Cleanup.`,
        409
      );
    }
    if (remoteHash !== edit.baselineContentHash) {
      throw new ToolExecutionError(
        "PATCH_GENERATION_FAILED",
        `File ${edit.path} changed on GitHub since this scan. Re-scan and regenerate cleanup changes before opening a PR.`,
        409
      );
    }
  }

  const existingRepodietBranches = (await input.client.listBranchesWithPrefix(
    input.owner,
    input.repo,
    REPODIET_BRANCH_PREFIX
  )).length;

  const openRepodietPullRequests = (
    await input.client.listOpenPullRequestsForHeadPrefix(input.owner, input.repo, "repodiet/")
  ).length;

  if (openRepodietPullRequests > 0) {
    warnings.push(
      `${openRepodietPullRequests} open RepoDiet cleanup PR(s) already exist. Review or close them before merging another cleanup.`
    );
  }
  if (existingRepodietBranches > 3) {
    warnings.push(
      `${existingRepodietBranches} repodiet/cleanup-* branches exist on this repository. Consider cleaning up stale branches after review.`
    );
  }

  const artifactSha = await input.client.getFileSha(
    input.owner,
    input.repo,
    "repodiet/patchkit-summary.json",
    input.baseBranch
  );
  if (artifactSha && input.validatedEdits.length > 0) {
    warnings.push(
      "repodiet/ artifacts already exist on the base branch from a prior cleanup merge. This PR will update or add new artifacts."
    );
  }

  return {
    warnings,
    liveBaseSha,
    openRepodietPullRequests,
    existingRepodietBranches,
  };
}
