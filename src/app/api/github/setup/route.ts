import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/github-app/config";
import {
  clearInstallSessionId,
  readInstallSessionId,
  saveInstallationSession,
} from "@/lib/github-app/session";
import { fetchInstallationSession } from "@/lib/github-app/installations";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const installationIdRaw = request.nextUrl.searchParams.get("installation_id");
  const state = request.nextUrl.searchParams.get("state");
  const installSessionId = await readInstallSessionId();

  if (!installationIdRaw) {
    return NextResponse.redirect(`${getAppBaseUrl()}/app?github_error=missing_installation`);
  }

  const installationId = Number(installationIdRaw);
  if (!Number.isFinite(installationId) || installationId <= 0) {
    return NextResponse.redirect(`${getAppBaseUrl()}/app?github_error=invalid_installation`);
  }

  if (state && installSessionId && state !== installSessionId) {
    return NextResponse.redirect(`${getAppBaseUrl()}/app?github_error=session_mismatch`);
  }

  try {
    const session = await fetchInstallationSession(installationId);
    await saveInstallationSession(session);
    await clearInstallSessionId();
  } catch {
    return NextResponse.redirect(`${getAppBaseUrl()}/app?github_error=setup_failed`);
  }

  const tab = request.nextUrl.searchParams.get("tab") ?? "patch";
  return NextResponse.redirect(`${getAppBaseUrl()}/app?github_connected=true&tab=${tab}`);
}
