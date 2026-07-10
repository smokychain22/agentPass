import { NextResponse } from "next/server";
import { isGitHubAppConfigured } from "@/lib/github-app/config";
import { accessCopyForState } from "@/lib/github-app/access-states";
import { buildSessionKey } from "@/lib/github-app/browser-session";
import { createInstallFlow } from "@/lib/github-app/install-flow";
import {
  parseRepositoryFullName,
  requiresRepositoryOwnerInstall,
} from "@/lib/github-app/repository";
import { readInstallationSession } from "@/lib/github-app/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isGitHubAppConfigured()) {
    return NextResponse.json(
      { ok: false, error: "GitHub App is not configured on this deployment." },
      { status: 503 }
    );
  }

  const body = (await request.json()) as {
    repositoryFullName?: string;
    scanId?: string;
    returnPath?: string;
  };

  if (!body.repositoryFullName?.trim()) {
    return NextResponse.json(
      { ok: false, error: "repositoryFullName is required." },
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
        error: err instanceof Error ? err.message : "Invalid repositoryFullName.",
      },
      { status: 422 }
    );
  }

  const sessionKey = await buildSessionKey(request);
  const returnPath =
    body.returnPath?.trim() ||
    `/app?tab=patch${body.scanId ? `&scanId=${encodeURIComponent(body.scanId)}` : ""}`;

  const repositoryFullName = body.repositoryFullName.trim();
  const { installUrl, stateToken } = await createInstallFlow({
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
  const accessState = ownerMismatch ? "wrong_account" : existing ? "installed_repo_missing" : "not_installed";
  const messages = accessCopyForState(accessState, repo, repositoryOwner);

  return NextResponse.json({
    ok: true,
    installUrl,
    stateToken,
    repositoryFullName,
    repositoryOwner,
    installationOwner,
    requiresRepositoryOwnerInstall: ownerMismatch,
    messages,
  });
}
