import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl, resolveRepodietReturnUrl } from "@/lib/github-app/app-base-url";
import { parseInstallCallbackParams } from "@/lib/github-app/install-callback";
import {
  clearInstallSessionId,
  saveInstallationSession,
} from "@/lib/github-app/session";
import {
  consumeInstallFlowState,
  resolveInstallFlowFromPendingCookie,
  resolveInstallFlowState,
} from "@/lib/github-app/install-flow";
import {
  fetchInstallationSession,
  installationIncludesRepositoryWithRetry,
} from "@/lib/github-app/installations";
import { saveRepoInstallBinding, type InstallFlowRecord } from "@/lib/github-app/install-flow-store";
import { buildSessionKey } from "@/lib/github-app/browser-session";
import { githubOwnersMatch } from "@/lib/github-app/repository";
import {
  clearPendingInstallCookie,
  readPendingInstallCookie,
} from "@/lib/github-app/install-flow-cookie";

export const runtime = "nodejs";

function redirectWithError(
  code: string,
  returnPath?: string,
  scanId?: string
): NextResponse {
  const url = resolveRepodietReturnUrl(returnPath, scanId);
  url.searchParams.set("github_error", code);
  return NextResponse.redirect(url.toString());
}

function redirectWithSuccess(
  returnPath: string | undefined,
  scanId: string | undefined,
  params: Record<string, string>
): NextResponse {
  const url = resolveRepodietReturnUrl(returnPath, scanId);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url.toString());
}

async function resolveFlowRecord(
  stateToken: string,
  sessionKey: string
): Promise<
  | { ok: true; record: InstallFlowRecord }
  | { ok: false; reason: "invalid" | "expired" | "reused" }
> {
  const primary = await resolveInstallFlowState(stateToken, sessionKey);
  if (primary.ok) return primary;

  const pending = await resolveInstallFlowFromPendingCookie();
  if (pending) {
    return { ok: true, record: { ...pending, sessionKey } };
  }

  return primary;
}

export async function GET(request: NextRequest) {
  const sessionKey = await buildSessionKey(request);
  const parsed = parseInstallCallbackParams(request.nextUrl.searchParams);

  if (!parsed.ok) {
    const pending = await readPendingInstallCookie();
    console.warn("[github-install-complete] invalid callback params", {
      errorCode: parsed.errorCode,
      appBaseUrl: getAppBaseUrl(),
      hasPendingCookie: Boolean(pending),
    });
    return redirectWithError(
      parsed.errorCode,
      pending?.returnPath,
      pending?.scanId
    );
  }

  const { installationId, setupAction, stateToken } = parsed.params;

  let resolved = await resolveFlowRecord(stateToken, sessionKey);

  if (!resolved.ok) {
    const pending = await readPendingInstallCookie();
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
      stateLength: stateToken.length,
      appBaseUrl: getAppBaseUrl(),
      hasPendingCookie: Boolean(pending),
    });

    try {
      const session = await fetchInstallationSession(installationId);
      await saveInstallationSession(session);
      await clearInstallSessionId();
      await clearPendingInstallCookie();

      return redirectWithSuccess(pending?.returnPath, pending?.scanId, {
        github: "connected",
        setup_action: setupAction,
        github_recovered: "installation_only",
      });
    } catch {
      await clearPendingInstallCookie();
      return redirectWithError(code, pending?.returnPath, pending?.scanId);
    }
  }

  const flow = { ...resolved.record, sessionKey };

  try {
    const session = await fetchInstallationSession(installationId);
    const ownerMatches = githubOwnersMatch(session.accountLogin, flow.owner);
    const access = await installationIncludesRepositoryWithRetry(
      installationId,
      flow.owner,
      flow.repo
    );

    console.info("[github-install-complete]", {
      installationId,
      setupAction,
      appBaseUrl: getAppBaseUrl(),
      targetOwner: flow.owner,
      targetRepo: flow.repo,
      installationOwner: session.accountLogin,
      ownerMatches,
      hasAccess: access.granted,
      accessibleRepoCount: access.accessibleRepos.length,
      accessibleReposSample: access.accessibleRepos.slice(0, 5),
      stateLength: stateToken.length,
    });

    if (!ownerMatches) {
      await consumeInstallFlowState(stateToken);
      return redirectWithError("wrong_account", flow.returnPath, flow.scanId);
    }

    await saveInstallationSession(session);
    await clearInstallSessionId();

    const trustUpdateCallback = setupAction === "update";

    if (!access.granted && !trustUpdateCallback) {
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

    const successParams: Record<string, string> = {
      github: "connected",
      setup_action: setupAction,
    };
    if (!access.granted && trustUpdateCallback) {
      successParams.github_repo_pending = "true";
    }

    return redirectWithSuccess(flow.returnPath, flow.scanId, successParams);
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
