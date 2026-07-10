import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { getGitHubAppInstallUrl, isGitHubAppConfigured } from "@/lib/github-app/config";
import { setInstallSessionId } from "@/lib/github-app/session";

export const runtime = "nodejs";

export async function GET() {
  if (!isGitHubAppConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: "GitHub App is not configured on this deployment.",
      },
      { status: 503 }
    );
  }

  const installSessionId = nanoid(24);
  await setInstallSessionId(installSessionId);

  const installUrl = getGitHubAppInstallUrl(installSessionId);
  return NextResponse.redirect(installUrl);
}
