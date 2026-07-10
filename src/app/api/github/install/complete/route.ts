import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl, resolveRepodietReturnUrl } from "@/lib/github-app/app-base-url";
import { parseInstallCallbackParams } from "@/lib/github-app/install-callback";
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
import { githubOwnersMatch } from "@/lib/github-app/repository";
import { clearPendingInstallCookie } from "@/lib/github-app/install-flow-cookie";

export const runtime = "nodejs";

function redirectWithError(code: string, returnPath?: string, scanId?: string) {
  const url = resolveRepodietReturnUrl(returnPath, scanId);
  url.searchParams.set("github_error", code);
  return NextResponse.redirect(url.toString());
}

export async function GET(request: NextRequest) {
  const parsed = parseInstallCallbackParams(request.nextUrl.searchParams);
  if (!parsed.ok) {
    console.warn("[github-install-complete] invalid callback params", {
      errorCode: parsed.errorCode,
      appBaseUrl: getAppBaseUrl(),
    });
    return redirectWithError(parsed.errorCode);
  }

  const { installationId, setupAction, stateToken } = parsed.params;

  const resolved = await resolveInstallFlowState(stateToken);
  if (!resolved.ok) {
    const code =
      resolved.reason === "expired"
        ? "state_expired"
        : resolved.reason === "reused"
          ? "state_reused"
          : "invalid_state";
    console.warn("[github-install-complete] state resolution failed", {
      reason: resolved.reason,
      installationId,
      setupAction,
      appBaseUrl: getAppBaseUrl(),
    });
    await clearPendingInstallCookie();
    return redirectWithError(code);
  }

  const flow = resolved.record;

  try {
    const session = await fetchInstallationSession(installationId);
    const ownerMatches = githubOwnersMatch(session.accountLogin, flow.owner);
    const hasAccess = await installationIncludesRepository(
      installationId,
      flow.owner,
      flow.repo
    );

    const sessionKey = await buildSessionKey(request);

    console.info("[github-install-complete]", {
      installationId,
      setupAction,
      appBaseUrl: getAppBaseUrl(),
      targetOwner: flow.owner,
      targetRepo: flow.repo,
      installationOwner: session.accountLogin,
      ownerMatches,
      hasAccess,
    });

    if (!ownerMatches) {
      await consumeInstallFlowState(stateToken);
      return redirectWithError("wrong_account", flow.returnPath, flow.scanId);
    }

    await saveInstallationSession(session);
    await clearInstallSessionId();

    if (!hasAccess) {
      await consumeInstallFlowState(stateToken);
      return redirectWithError("repo_not_granted", flow.returnPath, flow.scanId);
    }

    await saveRepoInstallBinding({
      sessionKey,
      installationId: session.installationId,
      installationOwner: session.accountLogin,
      installationOwnerType: session.accountType,
      repositoryFullName: flow.repositoryFullName,
      setupAction,
      authorizedAt: new Date().toISOString(),
    });

    await consumeInstallFlowState(stateToken);

    const returnUrl = resolveRepodietReturnUrl(flow.returnPath, flow.scanId);
    returnUrl.searchParams.set("github", "connected");
    returnUrl.searchParams.set("setup_action", setupAction);
    return NextResponse.redirect(returnUrl.toString());
  } catch (err) {
    console.error("[github-install-complete] setup failed", {
      installationId,
      setupAction,
      appBaseUrl: getAppBaseUrl(),
      targetOwner: flow.owner,
      targetRepo: flow.repo,
      error: err instanceof Error ? err.message : "unknown",
    });
    return redirectWithError("setup_failed", flow.returnPath, flow.scanId);
  }
}
