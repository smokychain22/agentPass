import { NextResponse } from "next/server";
import { isGitHubAppConfigured } from "@/lib/github-app/config";
import { createInstallationAccessToken } from "@/lib/github-app/installations";
import { readInstallationSession } from "@/lib/github-app/session";
import {
  buildPreviewDryRunDenial,
  isPreviewRepositoryWriteBlocked,
} from "@/lib/deployment/preview-dry-run";

export const runtime = "nodejs";

export async function POST() {
  if (isPreviewRepositoryWriteBlocked()) {
    return NextResponse.json(buildPreviewDryRunDenial(), { status: 403 });
  }

  if (!isGitHubAppConfigured()) {
    return NextResponse.json(
      { ok: false, error: { code: "GITHUB_APP_NOT_CONFIGURED", message: "GitHub App is not configured." } },
      { status: 503 }
    );
  }

  const session = await readInstallationSession();
  if (!session) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "GITHUB_APP_NOT_CONNECTED",
          message: "Install the RepoDiet GitHub App on the repository you want to clean.",
        },
      },
      { status: 401 }
    );
  }

  try {
    const token = await createInstallationAccessToken(session.installationId);
    return NextResponse.json({
      ok: true,
      connected: true,
      account: {
        login: session.accountLogin,
        type: session.accountType,
      },
      expiresAt: token.expiresAt,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to refresh GitHub App installation session.",
        },
      },
      { status: 500 }
    );
  }
}
