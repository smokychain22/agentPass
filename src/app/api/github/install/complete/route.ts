import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/github-app/config";
import {
  clearInstallSessionId,
  saveInstallationSession,
} from "@/lib/github-app/session";
import {
  consumeInstallFlowState,
  resolveInstallFlowState,
} from "@/lib/github-app/install-flow";
import {
  fetchInstallationSession,
  installationIncludesRepository,
} from "@/lib/github-app/installations";
import { saveRepoInstallBinding } from "@/lib/github-app/install-flow-store";
import { buildSessionKey } from "@/lib/github-app/browser-session";

export const runtime = "nodejs";

function redirectWithError(code: string, returnPath?: string, scanId?: string) {
  const base = returnPath ?? `${getAppBaseUrl()}/app?tab=patch`;
  const url = new URL(base, getAppBaseUrl());
  url.searchParams.set("github_error", code);
  if (scanId) url.searchParams.set("scanId", scanId);
  return NextResponse.redirect(url.toString());
}

export async function GET(request: NextRequest) {
  const installationIdRaw = request.nextUrl.searchParams.get("installation_id");
  const state = request.nextUrl.searchParams.get("state");

  if (!installationIdRaw) {
    return redirectWithError("missing_installation");
  }

  const installationId = Number(installationIdRaw);
  if (!Number.isFinite(installationId) || installationId <= 0) {
    return redirectWithError("invalid_installation");
  }

  if (!state) {
    return redirectWithError("invalid_state");
  }

  const resolved = await resolveInstallFlowState(state);
  if (!resolved.ok) {
    const code =
      resolved.reason === "expired"
        ? "state_expired"
        : resolved.reason === "reused"
          ? "state_reused"
          : "invalid_state";
    return redirectWithError(code);
  }

  const flow = resolved.record;

  try {
    const session = await fetchInstallationSession(installationId);
    const hasAccess = await installationIncludesRepository(
      installationId,
      flow.owner,
      flow.repo
    );

    await saveInstallationSession(session);
    await clearInstallSessionId();

    const sessionKey = await buildSessionKey(request);

    if (!hasAccess) {
      await consumeInstallFlowState(state);
      return redirectWithError("repo_not_granted", flow.returnPath, flow.scanId);
    }

    await saveRepoInstallBinding({
      sessionKey,
      installationId: session.installationId,
      installationOwner: session.accountLogin,
      installationOwnerType: session.accountType,
      repositoryFullName: flow.repositoryFullName,
      authorizedAt: new Date().toISOString(),
    });

    await consumeInstallFlowState(state);

    const returnUrl = new URL(flow.returnPath, getAppBaseUrl());
    returnUrl.searchParams.set("github", "connected");
    if (flow.scanId) returnUrl.searchParams.set("scanId", flow.scanId);
    return NextResponse.redirect(returnUrl.toString());
  } catch {
    return redirectWithError("setup_failed", flow.returnPath, flow.scanId);
  }
}
