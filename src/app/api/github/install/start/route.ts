import { NextResponse } from "next/server";
import { isGitHubAppConfigured } from "@/lib/github-app/config";
import { buildSessionKey } from "@/lib/github-app/browser-session";
import { createInstallFlow, getConfigureInstallationUrl } from "@/lib/github-app/install-flow";
import { parseRepositoryFullName } from "@/lib/github-app/repository";
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
  const returnPath =
    body.returnPath?.trim() ||
    `/app?tab=patch${body.scanId ? `&scanId=${encodeURIComponent(body.scanId)}` : ""}`;

  const { installUrl, stateToken } = await createInstallFlow({
    sessionKey,
    repositoryFullName: body.repositoryFullName.trim(),
    scanId: body.scanId,
    returnPath,
  });

  const existing = await readInstallationSession();
  const url =
    existing && body.repositoryFullName
      ? getConfigureInstallationUrl(existing.installationId, stateToken)
      : installUrl;

  return NextResponse.json({
    ok: true,
    installUrl: url,
  });
}
