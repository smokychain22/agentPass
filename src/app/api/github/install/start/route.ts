import { NextResponse } from "next/server";
import { isGitHubAppConfigured } from "@/lib/github-app/config";
import { accessCopyForState } from "@/lib/github-app/access-states";
import { resolveRepodietReturnUrl } from "@/lib/github-app/app-base-url";
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
  requiresRepositoryOwnerInstall,
} from "@/lib/github-app/repository";
import { readInstallationSession } from "@/lib/github-app/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isGitHubAppConfigured()) {
    return NextResponse.json(
      { ok: false, success: false, error: "GitHub App is not configured on this deployment." },
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

  const body = (await request.json()) as {
    repositoryFullName?: string;
    scanId?: string;
    returnPath?: string;
  };

  if (!body.repositoryFullName?.trim()) {
    return NextResponse.json(
      { ok: false, success: false, error: "repositoryFullName is required." },
      { status: 422 }
    );
  }

  let repositoryOwner: string;
  let repo: string;
  try {
    const parsed = parseRepositoryFullName(body.repositoryFullName);
    repositoryOwner = parsed.owner;
    repo = parsed.repo;
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        error: err instanceof Error ? err.message : "Invalid repositoryFullName.",
      },
      { status: 422 }
    );
  }

  const sessionKey = await buildSessionKey(request);
  const defaultReturnPath = resolveRepodietReturnUrl(
    "/app?tab=patch",
    body.scanId
  ).toString();
  const returnPath = body.returnPath?.trim() || defaultReturnPath;

  const repositoryFullName = body.repositoryFullName.trim();

  try {
    const { stateToken } = await createInstallFlow({
      sessionKey,
      repositoryFullName,
      scanId: body.scanId,
      returnPath,
    });

    const existing = await readInstallationSession();
    const installationOwner = existing?.accountLogin;
    const ownerMismatch = requiresRepositoryOwnerInstall({
      repositoryOwner,
      installationOwner,
    });

    let hasRepositoryAccess = false;
    if (existing && !ownerMismatch) {
      hasRepositoryAccess = await installationIncludesRepository(
        existing.installationId,
        repositoryOwner,
        repo
      );
    }

    const { url, flow } = resolveGitHubInstallRedirect({
      slug: appSlug,
      stateToken,
      installationId: existing?.installationId,
      requiresRepositoryOwnerInstall: ownerMismatch,
      hasRepositoryAccess,
    });

    assertValidGitHubInstallRedirectUrl(url, flow);

    console.info("[github-install-start]", {
      appSlug,
      flow,
      hasExistingInstallation: Boolean(existing?.installationId),
      targetOwner: repositoryOwner,
      targetRepo: repo,
    });

    const accessState = ownerMismatch
      ? "wrong_account"
      : existing
        ? hasRepositoryAccess
          ? "repository_verified"
          : "installed_repo_missing"
        : "not_installed";
    const messages = accessCopyForState(accessState, repo, repositoryOwner);

    return NextResponse.json({
      ok: true,
      success: true,
      url,
      installUrl: url,
      flow,
      stateToken,
      repositoryFullName,
      repositoryOwner,
      installationOwner,
      requiresRepositoryOwnerInstall: ownerMismatch,
      messages,
    });
  } catch (err) {
    console.error("[github-install-start] failed", {
      appSlug,
      targetOwner: repositoryOwner,
      targetRepo: repo,
      error: err instanceof Error ? err.message : "unknown",
    });
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
