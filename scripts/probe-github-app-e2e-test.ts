/**
 * Non-destructive GitHub App probe for velz-cmd/repodiet-e2e-test.
 * Uses production repository-status API only — never creates branches/PRs/files.
 *
 *   npx tsx scripts/probe-github-app-e2e-test.ts
 */
const BASE =
  process.env.REPODIET_PRODUCTION_URL || "https://skillswap-virid-kappa.vercel.app";
const REPO = "velz-cmd/repodiet-e2e-test";

async function main() {
  const res = await fetch(
    `${BASE}/api/github/repository-status?repository=${encodeURIComponent(REPO)}`
  );
  const body = (await res.json()) as Record<string, unknown>;
  const pass =
    res.ok &&
    body.ok === true &&
    body.configured === true &&
    body.connected === true &&
    body.authoritativeState === "repository_verified" &&
    body.installationTokenAvailable === true &&
    body.canCreateBranch === true &&
    body.canCreatePullRequest === true &&
    body.canRead === true;

  const report = {
    githubAppProbe: pass ? "PASS" : "FAIL",
    targetRepository: REPO,
    httpStatus: res.status,
    configured: body.configured === true,
    connected: body.connected === true,
    installationIdPresent: typeof body.installationId === "number",
    installationIdLast4: body.installationIdLast4 ?? null,
    authoritativeState: body.authoritativeState ?? null,
    accessState: body.accessState ?? null,
    canReadMetadata: body.canRead === true,
    contentsWriteReady: body.canCreateBranch === true,
    pullRequestsWriteReady: body.canCreatePullRequest === true,
    installationTokenMintable: body.installationTokenAvailable === true,
    tokenLoggedOrPersisted: false,
    repositoryWritePerformed: false,
    notes: [
      "Token is minted server-side for the probe and not returned in the response body.",
      "No branch, commit, file, PR, issue, or comment was created.",
    ],
  };

  console.log(JSON.stringify(report, null, 2));
  if (!pass) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
