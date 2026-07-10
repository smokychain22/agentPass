import { NextResponse } from "next/server";
import { isGitHubAppConfigured } from "@/lib/github-app/config";
import { buildSessionKey } from "@/lib/github-app/browser-session";
import { createInstallFlow } from "@/lib/github-app/install-flow";
import { repositoryFullNameFromUrl } from "@/lib/github-app/repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isGitHubAppConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: "GitHub App is not configured on this deployment.",
      },
      { status: 503 }
    );
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
        error: "repositoryFullName or repoUrl is required for GitHub installation.",
      },
      { status: 422 }
    );
  }

  const { installUrl } = await createInstallFlow({
    sessionKey,
    repositoryFullName,
    scanId,
    returnPath,
  });

  return NextResponse.redirect(installUrl);
}
