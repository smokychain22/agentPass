/**
 * Per-job delete approvals for the A2A cleanup deliverable.
 *
 * ## Why this exists
 *
 * Two allowlists govern a delete, and they are deliberately NOT the same:
 *
 *   - `SAFE_CANDIDATE_PATTERNS` (findings) decides what may be CLASSIFIED as a
 *     safe candidate. It includes `unused`.
 *   - `OPERATOR_SAFE_DIRS` (delivery) decides what an UNATTENDED delivery may
 *     delete with nobody approving it. It does not include `unused`.
 *
 * That gap is not a bug to be closed by widening the second list. Autonomous
 * deletion authority is the narrower of the two on purpose: `archive/`,
 * `backup/`, `old/`, `tmp/`, `temp/` and `*.backup.*` are directories whose
 * name is itself the evidence that the content is disposable. `unused/` is a
 * claim made by static analysis, which is a weaker warrant.
 *
 * Live consequence on the funded job
 * 0x22a216415e2b1176d2111b136584e42fd949f7c0cfca48c657a7d1ca8e6927c6: all four
 * safe candidates were classified safe and then refused at the delivery gate,
 * and `createCleanupPullRequest` threw `NO_SAFE_CANDIDATES` with
 * `Blocked paths: src/config/runtime-hook.ts, src/lib/orphan-a.ts,
 * src/lib/unused-helper.ts, src/unused/empty-module.ts`.
 *
 * `resolveValidatedDeliveryOps` already has the correct escape hatch for
 * exactly this: an explicitly approved path widens the policy for that path
 * only, and still must pass `isApprovedValidatedDeletePath` (protected routes,
 * configuration, secrets, lockfiles, CI remain rejected) AND appear in the
 * sandbox's own `validatedPaths`. Approval never bridges the gap between
 * "patch generation proposed it" and "validation confirmed it".
 *
 * So the fix is not a policy change. It is supplying the approval that the
 * gate was designed to require — narrowly, and bound to evidence.
 *
 * ## Anti-drift
 *
 * Approval and delivery do not maintain separate notions of what is
 * approvable. This module produces `approvedPaths`; the single gate in
 * `resolveValidatedDeliveryOps` remains the only thing that decides what is
 * deleted, and it applies `isApprovedValidatedDeletePath` to every entry here.
 * Nothing in this file can permit a path that gate rejects.
 *
 * ## Binding
 *
 * An approval is a statement about one reviewed repository state, so it is
 * keyed on all three of jobId + repository + base commit. Any mismatch yields
 * `[]` — no approval — rather than an approximation. If the base branch moves,
 * the approval expires by construction and the reviewed diff must be re-derived.
 */
import { parseGitHubUrl } from "@/lib/github/parse-github-url";

export interface JobDeliveryApproval {
  /** OKX on-chain job id this approval is scoped to. */
  jobId: string;
  /** Canonical repository, compared as owner/repo (case-insensitive). */
  repositoryUrl: string;
  /** Base commit the approved paths were reviewed against. */
  baseCommit: string;
  /** Repository-relative paths approved for deletion. Nothing else. */
  approvedDeletePaths: string[];
}

/**
 * The reviewed approvals. One entry, for the existing funded job.
 *
 * `src/unused/empty-module.ts` was selected as the smallest safe finding from
 * a real analysis of this repository at commit b890ac4b: finding
 * `fnd_o9CRobnVnD`, severity low, 42 bytes, empty/whitespace-only, zero
 * inbound imports, not route-like, `evidenceGrade: strong`,
 * `classificationLabel: eligible_for_removal`, transformer preflight
 * `actionable_candidate`.
 *
 * The other three safe candidates from that same scan
 * (`src/config/runtime-hook.ts`, `src/lib/orphan-a.ts`,
 * `src/lib/unused-helper.ts`) are deliberately NOT approved. They sit outside
 * both allowlists, and this job needs exactly one deletion.
 */
export const JOB_DELIVERY_APPROVALS: readonly JobDeliveryApproval[] = [
  {
    jobId: "0x22a216415e2b1176d2111b136584e42fd949f7c0cfca48c657a7d1ca8e6927c6",
    repositoryUrl: "https://github.com/velz-cmd/repodiet-e2e-test",
    baseCommit: "b890ac4b055e608a7729d442c92bfe1dce573e64",
    approvedDeletePaths: ["src/unused/empty-module.ts"],
  },
];

function sameRepository(a: string, b: string): boolean {
  const left = parseGitHubUrl(a);
  const right = parseGitHubUrl(b);
  if (!left || !right) return false;
  return (
    left.owner.toLowerCase() === right.owner.toLowerCase() &&
    left.repo.toLowerCase() === right.repo.toLowerCase()
  );
}

/**
 * The approved delete paths for one job against one exact repository state.
 *
 * Returns `[]` — meaning "no approval", not "approve everything" — whenever
 * any part of the binding fails to match. `[]` is also what
 * `normalizeApprovedPaths` treats as "caller is not using explicit approval",
 * so the unattended operator-safe default applies unchanged and this function
 * can never widen anything by returning nothing.
 */
export function approvedDeletePathsForJob(input: {
  jobId: string;
  repositoryUrl: string;
  baseCommit: string;
}): string[] {
  const jobId = input.jobId?.trim().toLowerCase();
  const baseCommit = input.baseCommit?.trim().toLowerCase();
  if (!jobId || !baseCommit || !input.repositoryUrl?.trim()) return [];

  const approval = JOB_DELIVERY_APPROVALS.find(
    (entry) =>
      entry.jobId.toLowerCase() === jobId &&
      entry.baseCommit.toLowerCase() === baseCommit &&
      sameRepository(entry.repositoryUrl, input.repositoryUrl)
  );

  return approval ? [...approval.approvedDeletePaths] : [];
}
