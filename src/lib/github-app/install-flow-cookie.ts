import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { InstallFlowRecord } from "./install-flow-store";
import { getGitHubAppConfig, isGitHubAppConfigured } from "./config";
import { hashInstallState, isInstallFlowExpired } from "./install-flow-store";

export const PENDING_INSTALL_COOKIE = "repodiet_pending_install";

const PENDING_INSTALL_MAX_AGE = 60 * 30;

export interface PendingInstallCookiePayload {
  stateHash: string;
  repositoryFullName: string;
  owner: string;
  repo: string;
  returnPath: string;
  scanId?: string;
  sessionKey: string;
  expiresAt: string;
}

function signPayload(encodedPayload: string): string {
  const { clientSecret } = getGitHubAppConfig();
  return createHmac("sha256", clientSecret).update(encodedPayload).digest("base64url");
}

function encodeSignedPayload(payload: PendingInstallCookiePayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signPayload(encoded)}`;
}

function decodeSignedPayload(value: string): PendingInstallCookiePayload | null {
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;

  const expected = signPayload(encoded);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    return JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as PendingInstallCookiePayload;
  } catch {
    return null;
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: PENDING_INSTALL_MAX_AGE,
  };
}

export function pendingInstallFromRecord(record: InstallFlowRecord): PendingInstallCookiePayload {
  return {
    stateHash: record.stateHash,
    repositoryFullName: record.repositoryFullName,
    owner: record.owner,
    repo: record.repo,
    returnPath: record.returnPath,
    scanId: record.scanId,
    sessionKey: record.sessionKey,
    expiresAt: record.expiresAt,
  };
}

export function recordFromPendingInstall(
  payload: PendingInstallCookiePayload
): InstallFlowRecord {
  return {
    stateHash: payload.stateHash,
    sessionKey: payload.sessionKey,
    repositoryFullName: payload.repositoryFullName,
    owner: payload.owner,
    repo: payload.repo,
    scanId: payload.scanId,
    returnPath: payload.returnPath,
    createdAt: new Date().toISOString(),
    expiresAt: payload.expiresAt,
  };
}

async function withCookieJar<T>(fn: (jar: Awaited<ReturnType<typeof cookies>>) => T): Promise<T | null> {
  try {
    const jar = await cookies();
    return fn(jar);
  } catch {
    return null;
  }
}

export async function savePendingInstallCookie(
  record: InstallFlowRecord
): Promise<void> {
  if (!isGitHubAppConfigured()) return;
  await withCookieJar((jar) => {
    jar.set(
      PENDING_INSTALL_COOKIE,
      encodeSignedPayload(pendingInstallFromRecord(record)),
      cookieOptions()
    );
  });
}

export async function readPendingInstallCookie(): Promise<PendingInstallCookiePayload | null> {
  if (!isGitHubAppConfigured()) return null;
  const raw = await withCookieJar((jar) => jar.get(PENDING_INSTALL_COOKIE)?.value ?? null);
  if (!raw) return null;
  return decodeSignedPayload(raw);
}

export async function clearPendingInstallCookie(): Promise<void> {
  await withCookieJar((jar) => {
    jar.delete(PENDING_INSTALL_COOKIE);
  });
}

export async function resolveInstallFlowFromCookie(
  stateToken: string
): Promise<InstallFlowRecord | null> {
  const payload = await readPendingInstallCookie();
  if (!payload) return null;
  if (hashInstallState(stateToken) !== payload.stateHash) return null;

  const record = recordFromPendingInstall(payload);
  if (isInstallFlowExpired(record)) return null;
  return record;
}
