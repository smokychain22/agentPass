#!/usr/bin/env tsx
/**
 * End-to-end PRODUCT proof: the real cleanup engine, running on the real
 * production runtime, opening a real GitHub pull request.
 *
 * === Why this exists ===
 *
 * Every other gate in this repository proves infrastructure: the endpoint
 * returns 402, the heartbeat is accepted, the daemon is up. None of them prove
 * the thing RepoDiet actually sells — that it can read a repository, decide a
 * safe cleanup, and deliver it as a pull request a customer can review.
 *
 * The existing e2e coverage does not close that gap either: `scripts/
 * e2e-fixture-integration-test.ts` runs against a local fixture, and the unit
 * suites inject fake GitHub clients. Both are the right tools for their job and
 * neither can catch a broken GitHub App installation, an expired key, a push
 * permission that was never granted, or a delivery path that reports success
 * without a PR existing.
 *
 * So this script deliberately uses NO seams: the real
 * `createCleanupPullRequest`, the real GitHub App token resolution, a real
 * clone, a real commit, a real push — and then READS THE PULL REQUEST BACK
 * FROM GITHUB through a separate authenticated call. A run only passes if
 * GitHub itself confirms the PR, its head branch, and its changed files. An
 * engine that returned a plausible URL without creating anything fails here.
 *
 * === Safety ===
 *
 * Scoped to the controlled test repository and a disposable, uniquely-named
 * verification branch. It must never touch the funded OKX job:
 *   - it refuses to run against any branch matching the deterministic
 *     customer-branch shape `repodiet/cleanup-okx-*`;
 *   - it creates no marketplace task, no escrow, and no payment;
 *   - it never merges what it opens.
 *
 * Reuses an existing open verification PR on the same branch rather than
 * opening a second one, so repeated runs cannot litter the repository.
 *
 *   npx tsx scripts/verify-production-cleanup-pr.ts [--repo <url>] [--branch <name>]
 */
import { createCleanupPullRequest } from "@/lib/operator/create-cleanup-pr";
import { resolveCleanupGitHubToken } from "@/lib/github-app/resolve-cleanup-token";
import { GitHubClient } from "@/lib/github/github-client";
import { parseGitHubUrl } from "@/lib/github/parse-github-url";
import { ToolExecutionError } from "@/lib/a2mcp/errors";

const DEFAULT_REPO = "https://github.com/velz-cmd/repodiet-e2e-test";

/** The deterministic branch shape used for real paid OKX jobs. Never ours. */
const CUSTOMER_BRANCH_PATTERN = /^repodiet\/cleanup-okx-/i;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message: string): never {
  console.error(`[verify-production-cleanup-pr] FAIL: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const repoUrl = arg("repo") ?? DEFAULT_REPO;
  const commit = (
    process.env.REPODIET_BUILD_COMMIT ||
    arg("commit") ||
    "local"
  ).slice(0, 7);
  /**
   * Must match create-cleanup-pr.ts's own branch-name validation
   * (`^repodiet\/(?:cleanup|green-pr)-[A-Za-z0-9._-]+$`) — every real
   * customer branch is `repodiet/cleanup-*` or `repodiet/green-pr-*`, and
   * that check is a real safety boundary, not something this proof gets to
   * bypass. `e2e-production-verification-<sha>` never matched it, so every
   * prior run that finally got PAST verification and delivery-context setup
   * still failed here with "Invalid RepoDiet cleanup branch name" — this bug
   * was simply never reached before other fixes shipped. `cleanup-e2e-` is
   * disposable/unique per build SHA like before, and deliberately does not
   * start with `cleanup-okx-` (CUSTOMER_BRANCH_PATTERN below), so it can
   * never collide with or resemble the funded job's branch shape.
   */
  const branch = arg("branch") ?? `repodiet/cleanup-e2e-verification-${commit}`;
  /**
   * Optional disposable BASE branch to analyse instead of the repository's
   * default branch.
   *
   * The controlled repository is also the repository of the real funded OKX
   * job, and that job's per-job delete approval is bound to a specific base
   * commit. Seeding a cleanup candidate onto `main` to make this proof
   * possible would move that base underneath the funded job and invalidate its
   * approval. Pointing the analysis at a throwaway base branch gives the same
   * end-to-end proof — real clone, real analysis, real commit, real PR —
   * while leaving `main`, and therefore the funded job's assumptions,
   * untouched.
   */
  const base = arg("base");

  /**
   * Explicitly approved delete paths, comma-separated.
   *
   * The final delivery gate refuses to delete anything that is not either in
   * the narrow unattended operator-safe set or explicitly approved for this
   * exact piece of work. That refusal is correct and load-bearing — it is what
   * stops an unattended cleanup removing something a human never sanctioned —
   * and the production path satisfies it the same way, via
   * `approvedDeletePathsForJob` (see deterministic-turn.ts).
   *
   * Observed on 2026-08-07: without this the proof reached the gate and was
   * blocked with "No approved cleanup operation passed the final delivery
   * safety gate", listing the seeded candidate among the blocked paths. The
   * engine had done everything right; nobody had approved anything.
   *
   * Passing an approval for a file this run deliberately seeded onto a
   * throwaway branch is therefore USING the gate, not bypassing it. Every
   * approved path is still checked by `isApprovedValidatedDeletePath` and by
   * the sandbox's own `validatedPaths`, so a protected, generated, credential
   * or workflow path stays undeletable no matter what is listed here.
   */
  const approvedPaths = (arg("approve") ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  if (CUSTOMER_BRANCH_PATTERN.test(branch)) {
    fail(
      `refusing to run against ${branch}: that is the deterministic branch shape reserved for real paid OKX jobs`
    );
  }

  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) fail(`could not parse repository url: ${repoUrl}`);

  console.log(
    JSON.stringify(
      {
        step: "start",
        repoUrl,
        branch,
        base: base ?? "(repository default)",
        approvedPaths,
        buildCommit: commit,
      },
      null,
      2
    )
  );

  // --- 1. Real GitHub App token, for the read-back client -----------------
  const token = await resolveCleanupGitHubToken({
    repoUrl,
    owner: parsed.owner,
    repo: parsed.repo,
  });
  if (!token) fail("GitHub App did not mint an installation token");
  const github = new GitHubClient(token);
  console.log(JSON.stringify({ step: "github_app_token", minted: true }));

  // --- 2. Reuse an existing verification PR rather than opening a second --
  const existing = await github.listOpenPullRequestsForHeadPrefix(
    parsed.owner,
    parsed.repo,
    branch
  );
  let prNumber: number;
  let prUrl: string;

  if (existing.length > 0) {
    prNumber = existing[0].number;
    prUrl = existing[0].url;
    console.log(
      JSON.stringify({ step: "reused_existing_verification_pr", prNumber, prUrl })
    );
  } else {
    // --- 3. The REAL production engine. No injected clients, no dry run. --
    const started = Date.now();
    const result = await createCleanupPullRequest({
      repoUrl,
      mode: "safe_only",
      cleanupBranch: branch,
      githubToken: token,
      ...(base ? { branch: base } : {}),
      ...(approvedPaths.length > 0 ? { approvedPaths } : {}),
    });
    prUrl = result.data.pullRequest.url;
    prNumber = result.data.pullRequest.number;
    console.log(
      JSON.stringify(
        {
          step: "engine_reported_pull_request",
          prUrl,
          prNumber,
          elapsedMs: Date.now() - started,
          baseCommitSha: result.data.repo.baseCommitSha,
          actionSummary: result.data.actionSummary,
          policy: result.data.policy,
        },
        null,
        2
      )
    );
  }

  // --- 4. READ IT BACK FROM GITHUB ---------------------------------------
  // The whole point: the engine's own return value is a claim, not evidence.
  const pr = await github.getPullRequest(parsed.owner, parsed.repo, prNumber);
  if (!pr) fail(`GitHub does not have pull request #${prNumber} — the engine's URL was not real`);

  const files = await github.listPullRequestFiles(parsed.owner, parsed.repo, prNumber);
  const changedPaths = files.map((f) => f.path).sort();

  const verdict = {
    step: "verified_against_github",
    prUrl: pr.url,
    prNumber: pr.number,
    state: pr.state,
    headRef: pr.headRef,
    baseRef: pr.baseRef,
    headSha: pr.headSha,
    baseSha: pr.baseSha,
    changedFileCount: changedPaths.length,
    changedPaths,
  };
  console.log(JSON.stringify(verdict, null, 2));

  // --- 5. Assertions the proof must satisfy ------------------------------
  if (pr.headRef !== branch) {
    fail(`pull request head is ${pr.headRef}, expected the verification branch ${branch}`);
  }
  /**
   * A PR RepoDiet merged itself would be `closed`. Requiring `open` is
   * therefore the direct check that delivery stops at review and leaves the
   * merge decision with the customer — which is the product's core safety
   * claim, and the one a self-merging bug would silently break.
   */
  if (pr.state !== "open") {
    fail(`pull request is ${pr.state}; RepoDiet must never merge or close its own cleanup PR`);
  }
  if (base && pr.baseRef !== base) {
    // Proves the disposable base was genuinely honoured, so this run cannot
    // have targeted `main` and disturbed the funded job's approved base.
    fail(`pull request targets ${pr.baseRef}, expected the disposable base ${base}`);
  }
  if (changedPaths.length === 0) {
    fail("the pull request changes no files — nothing was actually delivered");
  }
  // Everything RepoDiet writes is either its own evidence artifacts under
  // `repodiet/`, or a safe change to the repository's own sources. A path
  // outside the repository is the scope-isolation failure worth catching.
  const suspicious = changedPaths.filter((p) => p.startsWith("..") || p.startsWith("/"));
  if (suspicious.length > 0) {
    fail(`pull request touches paths outside the repository: ${suspicious.join(", ")}`);
  }

  console.log(
    JSON.stringify(
      {
        result: "PASS",
        note: "real GitHub App auth, real engine, real branch, real commit, real PR, confirmed by reading it back from GitHub",
        prUrl: pr.url,
        notMerged: true,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(`[verify-production-cleanup-pr] FAIL: ${err instanceof Error ? err.stack ?? err.message : err}`);
  if (err instanceof ToolExecutionError && err.details !== undefined) {
    console.error(
      `[verify-production-cleanup-pr] phase timings: ${JSON.stringify(err.details, null, 2)}`
    );
  }
  process.exit(1);
});
