import { NextResponse } from "next/server";
import { isGitHubAppConfigured } from "@/lib/github-app/config";
import { buildSessionKey } from "@/lib/github-app/browser-session";
import { createInstallFlow } from "@/lib/github-app/install-flow";
import {
  assertValidGitHubInstallRedirectUrl,
  getGitHubAppSlugOrThrow,
  GitHubAppSlugError,
  resolveGitHubInstallRedirect,
} from "@/lib/github-app/install-redirect";
import { installationIncludesRepository } from "@/lib/github-app/installations";
import {
  parseRepositoryFullName,
  repositoryFullNameFromUrl,
  requiresRepositoryOwnerInstall,
} from "@/lib/github-app/repository";
import { readInstallationSession } from "@/lib/github-app/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isGitHubAppConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        error: "GitHub App is not configured on this deployment.",
      },
      { status: 503 }
    );
  }

  let appSlug: string;
  try {
    appSlug = getGitHubAppSlugOrThrow();
  } catch (err) {
    const message =
      err instanceof GitHubAppSlugError
        ? err.message
        : "GITHUB_APP_SLUG is not configured.";
    return NextResponse.json({ ok: false, success: false, error: message }, { status: 503 });
  }

  const url = new URL(request.url);
  const repoUrl = url.searchParams.get("repoUrl") ?? "";
  const scanId = url.searchParams.get("scanId") ?? undefined;
  const repositoryFullName =
    url.searchParams.get("repositoryFullName") ??
    (repoUrl ? repositoryFullNameFromUrl(repoUrl) : null);

  const sessionKey = await buildSessionKey(request);
  const returnPath =
    url.searchParams.get("returnPath") ??
    `/app?tab=patch${scanId ? `&scanId=${encodeURIComponent(scanId)}` : ""}`;

  if (!repositoryFullName) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        error: "repositoryFullName or repoUrl is required for GitHub installation.",
      },
      { status: 422 }
    );
  }

  let owner: string;
  let repo: string;
  try {
    const parsed = parseRepositoryFullName(repositoryFullName);
    owner = parsed.owner;
    repo = parsed.repo;
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        error: err instanceof Error ? err.message : "Invalid repository.",
      },
      { status: 422 }
    );
  }

  try {
    const { stateToken } = await createInstallFlow({
      sessionKey,
      repositoryFullName,
      scanId,
      returnPath,
    });

    const existing = await readInstallationSession();
    const ownerMismatch = requiresRepositoryOwnerInstall({
      repositoryOwner: owner,
      installationOwner: existing?.accountLogin,
    });

    let hasRepositoryAccess = false;
    if (existing && !ownerMismatch) {
      hasRepositoryAccess = await installationIncludesRepository(
        existing.installationId,
        owner,
        repo
      );
    }

    const { url: redirectUrl, flow } = resolveGitHubInstallRedirect({
      slug: appSlug,
      stateToken,
      installationId: existing?.installationId,
      requiresRepositoryOwnerInstall: ownerMismatch,
      hasRepositoryAccess,
    });

    assertValidGitHubInstallRedirectUrl(redirectUrl, flow);

    console.info("[github-install-start]", {
      appSlug,
      flow,
      hasExistingInstallation: Boolean(existing?.installationId),
      targetOwner: owner,
      targetRepo: repo,
    });

    return NextResponse.redirect(redirectUrl);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        error:
          err instanceof Error
            ? err.message
            : "Could not start GitHub App installation flow.",
      },
      { status: 500 }
    );
  }
}
