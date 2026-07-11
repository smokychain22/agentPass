import { NextRequest, NextResponse } from "next/server";
import { buildSessionKey } from "@/lib/github-app/browser-session";
import { completeInstallAccess } from "@/lib/github-app/complete-install-access";
import { runGitHubPreflight } from "@/lib/github-app/preflight";
import { parseRepositoryFullName } from "@/lib/github-app/repository";
import { readInstallationSession } from "@/lib/github-app/session";
import { verifySignedInstallState } from "@/lib/github-app/install-signed-state";
import { readPendingInstallCookie } from "@/lib/github-app/install-flow-cookie";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json()) as {
    repositoryFullName?: string;
    installationId?: number;
    setupAction?: "install" | "update";
    trustPendingPropagation?: boolean;
  };

  if (!body.repositoryFullName?.trim()) {
    return NextResponse.json(
      { ok: false, error: "repositoryFullName is required." },
      { status: 422 }
    );
  }

  try {
    parseRepositoryFullName(body.repositoryFullName);
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
  const session = await readInstallationSession();
  const installationId = body.installationId ?? session?.installationId;

  if (!installationId) {
    return NextResponse.json(
      { ok: false, error: "GitHub App is not connected for this browser session." },
      { status: 401 }
    );
  }

  try {
    const completed = await completeInstallAccess({
      installationId,
      repositoryFullName: body.repositoryFullName.trim(),
      sessionKey,
      setupAction: body.setupAction,
      trustPendingPropagation: body.trustPendingPropagation === true,
    });

    const preflight = await runGitHubPreflight({
      repositoryFullName: body.repositoryFullName.trim(),
      sessionKey,
    });

    return NextResponse.json({
      ok: true,
      synced: true,
      repositoryAccessible: completed.repositoryAccessible,
      preflight,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not sync GitHub repository access.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const repositoryFullName = params.get("repositoryFullName")?.trim();
  const installationIdRaw = params.get("installation_id") ?? params.get("installationId");
  const stateToken = params.get("state")?.trim();
  const setupAction =
    params.get("setup_action") === "update" ? "update" : ("install" as const);

  let resolvedRepository = repositoryFullName;
  if (!resolvedRepository && stateToken) {
    const signed = verifySignedInstallState(stateToken);
    if (signed?.rf) resolvedRepository = signed.rf;
  }
  if (!resolvedRepository) {
    const pending = await readPendingInstallCookie();
    resolvedRepository = pending?.repositoryFullName;
  }

  if (!resolvedRepository) {
    return NextResponse.json(
      { ok: false, error: "repositoryFullName is required." },
      { status: 422 }
    );
  }

  const installationId = installationIdRaw ? Number(installationIdRaw) : undefined;
  const sessionKey = await buildSessionKey(request);
  const session = await readInstallationSession();
  const resolvedInstallationId = installationId ?? session?.installationId;

  if (!resolvedInstallationId || !Number.isFinite(resolvedInstallationId)) {
    return NextResponse.json(
      { ok: false, error: "installation_id is required when GitHub is not connected." },
      { status: 401 }
    );
  }

  try {
    const completed = await completeInstallAccess({
      installationId: resolvedInstallationId,
      repositoryFullName: resolvedRepository,
      sessionKey,
      setupAction,
      trustPendingPropagation: setupAction === "update",
    });

    const preflight = await runGitHubPreflight({
      repositoryFullName: resolvedRepository,
      sessionKey,
    });

    return NextResponse.json({
      ok: true,
      synced: true,
      repositoryAccessible: completed.repositoryAccessible,
      preflight,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not sync GitHub repository access.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
