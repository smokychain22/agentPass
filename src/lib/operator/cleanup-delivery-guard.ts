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
  /** True when the base branch moved since scan but RepoDiet safely continued without a re-scan (see Part 12C). */
  baseAutoRecovered: boolean;
}

export function commitShaMatches(scanSha: string, liveSha: string): boolean {
  const scan = scanSha.trim().toLowerCase();
  const live = liveSha.trim().toLowerCase();
  return live === scan || live.startsWith(scan) || scan.startsWith(live);
}

export type PatchValidationFreshnessResult =
  | { ok: true }
  | { ok: false; reason: "UNVALIDATED_PATHS"; unvalidatedPaths: string[] }
  | { ok: false; reason: "COMMIT_DRIFT"; validationCommit: string; scanCommit: string };

/**
 * PR C — delivery-time fingerprint re-binding (docs/A2A_SANDBOX_VALIDATION_PLAN.md).
 *
 * A "passed" `patchValidation` on a patch kit only proves *some* prior edit
 * set was git-apply-validated — not that it covers the exact paths about to
 * be delivered right now. `validatedEdits`/`deletePaths` can legitimately be
 * narrowed after validation (approvedDeletePaths scoping, a repair re-run
 * that mutates the same cleanupRunId's payload), which would let a delivery
 * ship paths `git apply --check` never actually saw — "validate patch A,
 * deliver patch B". Pure so it can be unit-tested without mocking the full
 * GitHub delivery pipeline; the caller decides what to do with the result.
 */
export function checkPatchValidationFreshness(input: {
  validatedPaths: string[] | undefined;
  deliveredPaths: string[];
  validationBaseCommitSha: string | undefined;
  scanCommitSha: string | undefined;
}): PatchValidationFreshnessResult {
  const validationCommit = input.validationBaseCommitSha?.trim();
  const scanCommit = input.scanCommitSha?.trim();
  if (validationCommit && scanCommit && !commitShaMatches(scanCommit, validationCommit)) {
    return { ok: false, reason: "COMMIT_DRIFT", validationCommit, scanCommit };
  }

  const validated = new Set(input.validatedPaths ?? []);
  const unvalidatedPaths = input.deliveredPaths.filter((p) => !validated.has(p));
  if (unvalidatedPaths.length > 0) {
    return { ok: false, reason: "UNVALIDATED_PATHS", unvalidatedPaths };
  }

  return { ok: true };
}

export async function assertCleanupDeliveryContext(input: {
  client: GitHubClient;
  owner: string;
  repo: string;
  baseBranch: string;
  scanCommitSha?: string;
  validatedEdits: CleanupDeliveryEdit[];
  /** Delete targets for this delivery, if any — presence disqualifies auto-recovery (see below). */
  deletePaths?: string[];
}): Promise<CleanupDeliveryContextResult> {
  const warnings: string[] = [];
  const liveBaseSha = await input.client.getBranchSha(input.owner, input.repo, input.baseBranch);
  let baseAutoRecovered = false;

  if (input.scanCommitSha?.trim() && !commitShaMatches(input.scanCommitSha, liveBaseSha)) {
    // Bounded, safe auto-recovery (Part 12C): the base branch moved, but
    // this delivery only edits files (never deletes — a moved base cannot
    // be safely trusted for a delete without re-confirming the file still
    // exists in the same state, which is out of scope here) and every
    // approved edit's baseline content is byte-identical on the new
    // commit. In that case it is safe to continue on the current base
    // without a fresh scan or another payment. Any other case — a
    // deletion is involved, there are no edits to check, or any edit's
    // content actually changed — still hard-fails exactly as before.
    const hasDeletes = (input.deletePaths?.length ?? 0) > 0;
    const canAttemptAutoRecovery = !hasDeletes && input.validatedEdits.length > 0;
    const allEditsUnchanged = canAttemptAutoRecovery
      ? await Promise.all(
          input.validatedEdits.map(async (edit) => {
            if (!edit.baselineContentHash) return false;
            const remote = await input.client.getFileContent(
              input.owner,
              input.repo,
              edit.path,
              input.baseBranch
            );
            return hashSource(remote ?? "") === edit.baselineContentHash;
          })
        )
      : [];

    if (canAttemptAutoRecovery && allEditsUnchanged.length > 0 && allEditsUnchanged.every(Boolean)) {
      baseAutoRecovered = true;
      warnings.push(
        `The base branch moved since this scan (scanned ${input.scanCommitSha.slice(0, 12)}…, live ${liveBaseSha.slice(0, 12)}…), but every approved file is unchanged on the new commit — RepoDiet continued on the current base without requiring a new scan or payment.`
      );
    } else {
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
    baseAutoRecovered,
  };
}
