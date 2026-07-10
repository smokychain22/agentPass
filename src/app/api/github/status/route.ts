import { NextResponse } from "next/server";
import { isGitHubAppConfigured } from "@/lib/github-app/config";
import { getInstallationPermissions } from "@/lib/github-app/installations";
import { readInstallationSession } from "@/lib/github-app/session";
import type { GitHubConnectionStatus } from "@/lib/github-app/types";

export const runtime = "nodejs";

export async function GET() {
  const configured = isGitHubAppConfigured();
  const session = configured ? await readInstallationSession() : null;

  const body: GitHubConnectionStatus = {
    connected: Boolean(session),
    configured,
  };

  if (session) {
    body.account = {
      login: session.accountLogin,
      type: session.accountType,
    };

    try {
      const permissions = await getInstallationPermissions(session.installationId);
      if (permissions) body.permissions = permissions;
    } catch {
      // Status still useful without live permission refresh.
    }
  }

  return NextResponse.json({ ok: true, ...body });
}
