import { NextResponse } from "next/server";
import { parseGitHubUrl } from "@/lib/github/parse-github-url";
import { resolveAuthoritativeRepositoryAccess } from "@/lib/github-app/authoritative-repository-access";
import { isRepositoryVerifiedState } from "@/lib/github-app/authoritative-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Authoritative GitHub write-capability check for a single repository.
 *
 * This exists because the Create Cleanup PR tab previously asked
 * `/api/okx/intake/repository` whether GitHub was connected. That endpoint is
 * a repository *intake* route: it answers as the anonymous read-only tenant
 * (so it can never observe a GitHub App installation, and always reports
 * `canCreatePullRequest: false`), and it enqueues a deep-scan job as a side
 * effect. Using it as a capability probe meant the UI could never show
 * "Connected" no matter how the install went, and every mount queued a scan.
 *
 * This route performs a real server-side installation lookup and returns the
 * structured capability contract. It has NO side effects: no scan is queued,
 * no branch or PR is created, no payment or task is started. Installation
 * tokens are minted server-side only and never returned.
 */
export async function POST(request: Request) {
  let body: { repositoryUrl?: string; installationId?: number };
  try {
    body = (await request.json()) as { repositoryUrl?: string; installationId?: number };
  } catch {
    return NextResponse.json(
      { ok: false, failureCode: "invalid_body", failureReason: "Request body must be valid JSON." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const parsed = body.repositoryUrl ? parseGitHubUrl(body.repositoryUrl) : null;
  if (!parsed) {
    return NextResponse.json(
      {
        ok: false,
        failureCode: "invalid_repository_url",
        failureReason: "repositoryUrl must be a valid GitHub repository URL.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const access = await resolveAuthoritativeRepositoryAccess({
    owner: parsed.owner,
    repo: parsed.repo,
    installationIdHint:
      typeof body.installationId === "number" && Number.isFinite(body.installationId)
        ? body.installationId
        : undefined,
  });

  // Write capability is only ever asserted from a fully verified installation
  // that actually holds this repository with sufficient granted permissions.
  // Every individual capability derives from that same authoritative state —
  // never from a callback query parameter or cached client state.
  const verified =
    isRepositoryVerifiedState(access.authoritativeState) &&
    access.installationFound &&
    access.repositorySelected &&
    access.installationTokenAvailable;

  const contentsWrite = access.contentsPermission === "write";
  const pullRequestsWrite = access.pullRequestsPermission === "write";

  const missingPermissions: string[] = [];
  if (access.installationFound && !contentsWrite) missingPermissions.push("contents: write");
  if (access.installationFound && !pullRequestsWrite) missingPermissions.push("pull_requests: write");

  const canReadRepository = verified;
  const canCreateBranch = verified && contentsWrite;
  const canPushChanges = verified && contentsWrite;
  const canCreatePullRequest = verified && contentsWrite && pullRequestsWrite;

  const connected =
    access.installationFound &&
    access.repositorySelected &&
    canReadRepository &&
    canCreateBranch &&
    canPushChanges &&
    canCreatePullRequest;

  const connectionState = connected
    ? "connected"
    : !access.installationFound
      ? "not_connected"
      : !access.repositorySelected
        ? "repository_not_selected"
        : missingPermissions.length > 0
          ? "permission_update_required"
          : "verification_failed";

  return NextResponse.json(
    {
      ok: true,
      connectionState,
      connected,
      installationFound: access.installationFound,
      installationIdLast4: access.installationIdLast4,
      installationOwner: access.account,
      repositorySelected: access.repositorySelected,
      repositoryFullName: access.repository,
      canReadRepository,
      canCreateBranch,
      canPushChanges,
      canCreatePullRequest,
      // Check-status access rides on the same installation; RepoDiet reads
      // check runs with the installation token it already holds.
      canReadChecks: verified,
      permissions: {
        contents: access.contentsPermission,
        pullRequests: access.pullRequestsPermission,
      },
      missingPermissions,
      repositorySelection: access.repositorySelection,
      verifiedAt: access.checkedAt,
      failureCode: connected ? undefined : access.authoritativeState,
      failureReason: connected ? undefined : access.diagnosticReason,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
