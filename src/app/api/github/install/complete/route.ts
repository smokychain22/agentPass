import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl, resolveRepodietReturnUrl } from "@/lib/github-app/app-base-url";
import { completeInstallAccess } from "@/lib/github-app/complete-install-access";
import { parseInstallCallbackParams } from "@/lib/github-app/install-callback";
import { clearInstallSessionId } from "@/lib/github-app/session";
import {
  consumeInstallFlowState,
  resolveInstallFlowFromPendingCookie,
  resolveInstallFlowState,
} from "@/lib/github-app/install-flow";
import { verifySignedInstallState } from "@/lib/github-app/install-signed-state";
import { buildSessionKey } from "@/lib/github-app/browser-session";
import {
  clearPendingInstallCookie,
  readPendingInstallCookie,
} from "@/lib/github-app/install-flow-cookie";
import type { InstallFlowRecord } from "@/lib/github-app/install-flow-store";
import { resolveAuthoritativeRepositoryAccess } from "@/lib/github-app/authoritative-repository-access";
import { installationIdLastFour } from "@/lib/github-app/authoritative-access";
import { safeCallbackDiagnostics } from "@/lib/github-app/callback-diagnostics";

export const runtime = "nodejs";
export const maxDuration = 60;

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

  const signed = verifySignedInstallState(stateToken);
  if (signed) {
    const { parseRepositoryFullName } = await import("@/lib/github-app/repository");
    const { owner, repo } = parseRepositoryFullName(signed.rf);
    return {
      ok: true,
      record: {
        stateHash: stateToken.slice(0, 32),
        sessionKey,
        repositoryFullName: signed.rf,
        owner,
        repo,
        scanId: signed.s,
        returnPath: signed.rp,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
    };
  }

  return primary;
}

async function recoverInstallContext(
  stateToken: string,
  sessionKey: string
): Promise<{
  repositoryFullName: string;
  returnPath?: string;
  scanId?: string;
  owner: string;
  repo: string;
} | null> {
  const pending = await readPendingInstallCookie();
  if (pending) {
    return {
      repositoryFullName: pending.repositoryFullName,
      returnPath: pending.returnPath,
      scanId: pending.scanId,
      owner: pending.owner,
      repo: pending.repo,
    };
  }

  const signed = verifySignedInstallState(stateToken);
  if (signed) {
    const { parseRepositoryFullName } = await import("@/lib/github-app/repository");
    const { owner, repo } = parseRepositoryFullName(signed.rf);
    return {
      repositoryFullName: signed.rf,
      returnPath: signed.rp,
      scanId: signed.s,
      owner,
      repo,
    };
  }

  const resolved = await resolveInstallFlowState(stateToken, sessionKey);
  if (resolved.ok) {
    return {
      repositoryFullName: resolved.record.repositoryFullName,
      returnPath: resolved.record.returnPath,
      scanId: resolved.record.scanId,
      owner: resolved.record.owner,
      repo: resolved.record.repo,
    };
  }

  return null;
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
  const trustUpdateCallback = setupAction === "update";
  const callbackOrigin = getAppBaseUrl();

  console.info(
    "[github-install-complete] callback received",
    safeCallbackDiagnostics({
      setupAction,
      installationId,
      callbackOrigin,
      stateValid: true,
    })
  );

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

    const recovered = await recoverInstallContext(stateToken, sessionKey);
    if (!recovered) {
      await clearPendingInstallCookie();
      return redirectWithError(code, pending?.returnPath, pending?.scanId);
    }

    try {
      const completed = await completeInstallAccess({
        installationId,
        repositoryFullName: recovered.repositoryFullName,
        sessionKey,
        setupAction,
        trustPendingPropagation: trustUpdateCallback,
      });

      const postAccess = await resolveAuthoritativeRepositoryAccess({
        owner: recovered.owner,
        repo: recovered.repo,
        installationIdHint: installationId,
        expectedAccount: recovered.owner,
      });

      console.info(
        "[github-install-complete] recovered callback persisted",
        safeCallbackDiagnostics({
          setupAction,
          installationId,
          callbackOrigin,
          repository: recovered.repositoryFullName,
          stateValid: true,
          persistenceResult: completed.bindingSaved
            ? completed.aspPersisted
              ? "binding_and_asp"
              : "binding_only"
            : "failed",
          postCallbackState: postAccess.authoritativeState,
        })
      );

      await clearInstallSessionId();
      await clearPendingInstallCookie();

      const successParams: Record<string, string> = {
        github: "connected",
        setup_action: setupAction,
        github_recovered: "installation_only",
        github_installation_id: String(installationId),
      };
      if (!completed.repositoryAccessible && trustUpdateCallback) {
        successParams.github_repo_pending = "true";
      }

      return redirectWithSuccess(recovered.returnPath, recovered.scanId, successParams);
    } catch {
      await clearPendingInstallCookie();
      return redirectWithError(code, pending?.returnPath, pending?.scanId);
    }
  }

  const flow = { ...resolved.record, sessionKey };

  try {
    const completed = await completeInstallAccess({
      installationId,
      repositoryFullName: flow.repositoryFullName,
      sessionKey,
      setupAction,
      trustPendingPropagation: trustUpdateCallback,
    });

    const postAccess = await resolveAuthoritativeRepositoryAccess({
      owner: flow.owner,
      repo: flow.repo,
      installationIdHint: installationId,
      expectedAccount: flow.owner,
    });

    console.info(
      "[github-install-complete] callback persisted",
      safeCallbackDiagnostics({
        setupAction,
        installationId,
        callbackOrigin,
        repository: flow.repositoryFullName,
        stateValid: true,
        persistenceResult: completed.bindingSaved
          ? completed.aspPersisted
            ? "binding_and_asp"
            : "binding_only"
          : "failed",
        postCallbackState: postAccess.authoritativeState,
      })
    );

    await clearInstallSessionId();

    if (!completed.repositoryAccessible && !trustUpdateCallback) {
      await consumeInstallFlowState(stateToken);
      await clearPendingInstallCookie();

      const successParams: Record<string, string> = {
        github: "connected",
        setup_action: setupAction,
        github_installation_id: String(installationId),
        github_repo_pending: "true",
      };

      return redirectWithSuccess(flow.returnPath, flow.scanId, successParams);
    }

    await consumeInstallFlowState(stateToken);
    await clearPendingInstallCookie();

    const { parseAspJobIdFromReturnPath } = await import("@/lib/asp/install-callback");
    const { recordAspInstallBinding } = await import("@/lib/asp/job-service");
    const aspJobId = parseAspJobIdFromReturnPath(flow.returnPath);
    if (aspJobId) {
      await recordAspInstallBinding({
        jobId: aspJobId,
        installationId,
        repositoryFullName: flow.repositoryFullName,
      }).catch(() => undefined);
    }

    const successParams: Record<string, string> = {
      github: "connected",
      setup_action: setupAction,
      github_installation_id: String(installationId),
    };
    if (!completed.repositoryAccessible && trustUpdateCallback) {
      successParams.github_repo_pending = "true";
    }

    return redirectWithSuccess(flow.returnPath, flow.scanId, successParams);
  } catch (err) {
    console.error("[github-install-complete] setup failed", {
      installationId,
      installationIdLast4: installationIdLastFour(installationId),
      setupAction,
      appBaseUrl: getAppBaseUrl(),
      targetOwner: flow.owner,
      targetRepo: flow.repo,
      error: err instanceof Error ? err.message : "unknown",
    });
    return redirectWithError("setup_failed", flow.returnPath, flow.scanId);
  }
}
