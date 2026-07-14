import { NextRequest, NextResponse } from "next/server";
import { buildSessionKey } from "@/lib/github-app/browser-session";
import { runGitHubAccessSync } from "@/lib/github-app/complete-install-access";
import { parseRepositoryFullName } from "@/lib/github-app/repository";
import { readInstallationSession } from "@/lib/github-app/session";
import { resolveAuthoritativeRepositoryAccess } from "@/lib/github-app/authoritative-repository-access";

export const runtime = "nodejs";
export const maxDuration = 30;

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
};

function readInstallationIdFromRequest(request: NextRequest): number | undefined {
  const raw =
    request.nextUrl.searchParams.get("installation_id") ??
    request.nextUrl.searchParams.get("github_installation_id");
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    repositoryFullName?: string;
    installationId?: number;
    setupAction?: "install" | "update";
    trustPendingPropagation?: boolean;
    quick?: boolean;
    branch?: string;
    scanId?: string;
    commitSha?: string;
  };

  if (!body.repositoryFullName?.trim()) {
    return NextResponse.json(
      { ok: false, error: "repositoryFullName is required." },
      { status: 422, headers: NO_STORE }
    );
  }

  let owner: string;
  let repo: string;
  try {
    ({ owner, repo } = parseRepositoryFullName(body.repositoryFullName));
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Invalid repositoryFullName.",
      },
      { status: 422, headers: NO_STORE }
    );
  }

  const sessionKey = await buildSessionKey(request);
  const session = await readInstallationSession();
  const installationId = body.installationId ?? session?.installationId;

  if (!installationId) {
    return NextResponse.json(
      { ok: false, error: "GitHub App is not connected for this browser session." },
      { status: 401, headers: NO_STORE }
    );
  }

  try {
    const { completed, preflight } = await runGitHubAccessSync({
      repositoryFullName: body.repositoryFullName.trim(),
      sessionKey,
      installationId,
      setupAction: body.setupAction,
      trustPendingPropagation: body.trustPendingPropagation === true,
      quick: body.quick === true,
      branch: body.branch,
      scanId: body.scanId,
      commitSha: body.commitSha,
    });

    const authoritative = await resolveAuthoritativeRepositoryAccess({
      owner,
      repo,
      installationIdHint: installationId,
      expectedAccount: owner,
    });

    return NextResponse.json(
      {
        ok: true,
        synced: true,
        repositoryAccessible: completed.repositoryAccessible,
        bindingSaved: completed.bindingSaved,
        aspPersisted: completed.aspPersisted,
        preflight,
        authoritative,
      },
      { headers: NO_STORE }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not sync GitHub repository access.";
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: NO_STORE });
  }
}

export async function GET(request: NextRequest) {
  const installationId = readInstallationIdFromRequest(request);
  const setupActionParam = request.nextUrl.searchParams.get("setup_action");
  return POST(
    new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({
        repositoryFullName: request.nextUrl.searchParams.get("repositoryFullName"),
        installationId,
        setupAction: setupActionParam === "update" ? "update" : undefined,
        trustPendingPropagation:
          setupActionParam === "update" || request.nextUrl.searchParams.get("github_repo_pending") === "true",
      }),
    })
  );
}
