import { NextRequest, NextResponse } from "next/server";
import { buildSessionKey } from "@/lib/github-app/browser-session";
import { runGitHubAccessSync } from "@/lib/github-app/complete-install-access";
import { parseRepositoryFullName } from "@/lib/github-app/repository";
import { readInstallationSession } from "@/lib/github-app/session";

export const runtime = "nodejs";
export const maxDuration = 30;

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

    return NextResponse.json({
      ok: true,
      synced: true,
      repositoryAccessible: completed.repositoryAccessible,
      bindingSaved: completed.bindingSaved,
      preflight,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not sync GitHub repository access.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(
    new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({
        repositoryFullName: request.nextUrl.searchParams.get("repositoryFullName"),
        installationId: Number(request.nextUrl.searchParams.get("installation_id") ?? "") || undefined,
        setupAction:
          request.nextUrl.searchParams.get("setup_action") === "update" ? "update" : undefined,
        trustPendingPropagation: request.nextUrl.searchParams.get("setup_action") === "update",
      }),
    })
  );
}
