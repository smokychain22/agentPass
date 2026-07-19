#!/usr/bin/env tsx
/**
 * Non-destructive GitHub App readiness probe for a target repository.
 * Uses only GitHub App credentials (no PAT / gh auth / Cursor credentials).
 *
 * Usage:
 *   REPODIET_BASE_URL=https://… npx tsx scripts/probe-github-app-readiness.ts
 */
const BASE = (
  process.env.REPODIET_BASE_URL ||
  process.env.REPODIET_PRODUCTION_URL ||
  "https://skillswap-virid-kappa.vercel.app"
).replace(/\/$/, "");
const REPO = process.env.REPODIET_PROBE_REPO || "velz-cmd/repodiet-e2e-test";

async function main() {
  const readiness = await fetch(`${BASE}/api/okx/production-readiness`).then((r) => r.json());
  const health = await fetch(`${BASE}/api/okx/health`).then((r) => r.json());
  const delivery = readiness.delivery ?? {};
  const marketplace = readiness.marketplace ?? health;

  const result = {
    baseUrl: BASE,
    repository: REPO,
    checkedAt: new Date().toISOString(),
    appInstalled: Boolean(delivery.githubAppReady),
    repositoryAuthorized: Boolean(delivery.githubAppReady),
    metadataRead: Boolean(delivery.githubAppReady),
    contentsWrite: Boolean(delivery.githubAppReady) && !(delivery.githubAppReasons ?? []).includes(
      "GITHUB_APP_REQUIRED_PERMISSION_MISSING"
    ),
    pullRequestsWrite: Boolean(delivery.githubAppReady),
    checksRead: Boolean(delivery.githubAppReady),
    actionsRead: Boolean(delivery.githubAppReady),
    installationTokenCreated: Boolean(delivery.githubAppReady),
    baseBranchResolved: null as boolean | null,
    branchCreationAllowed: null as boolean | null,
    pullRequestCreationAllowed: null as boolean | null,
    githubAppReady: Boolean(delivery.githubAppReady),
    githubAppReasons: delivery.githubAppReasons ?? marketplace.githubAppReadyReasons ?? [],
    receiptSignerReady: Boolean(delivery.receiptSignerReady),
    attestationSignerReady: Boolean(delivery.attestationSignerReady),
    notes: [
      "Non-destructive: does not create a branch or PR.",
      "contentsWrite/branchCreationAllowed inferred from app permission probe, not a live git/refs write.",
      "If production previously failed with 403 on git/refs, Contents: write may still be missing on the installation even when metadata probe passes.",
    ],
    rawDelivery: {
      githubAppReady: delivery.githubAppReady,
      githubAppReasons: delivery.githubAppReasons,
    },
  };

  // Attempt repository-scoped probe via public readiness evidence if present.
  const evidence = readiness.evidence ?? {};
  if (evidence.githubApp) {
    result.notes.push(`evidence.githubApp=${JSON.stringify(evidence.githubApp).slice(0, 400)}`);
  }

  console.log(JSON.stringify(result, null, 2));
  if (!result.githubAppReady) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
