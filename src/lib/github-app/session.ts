import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { GitHubInstallationSession } from "./types";
import { getGitHubAppConfig, isGitHubAppConfigured } from "./config";

export const INSTALL_SESSION_COOKIE = "repodiet_install_session";
export const INSTALLATION_COOKIE = "repodiet_github_install";

const INSTALL_SESSION_MAX_AGE = 60 * 30;
const INSTALLATION_MAX_AGE = 60 * 60 * 24 * 90;

function sessionSecret(): string {
  const { clientSecret } = getGitHubAppConfig();
  return clientSecret;
}

function signPayload(encodedPayload: string): string {
  return createHmac("sha256", sessionSecret()).update(encodedPayload).digest("base64url");
}

function encodeSignedSession(payload: GitHubInstallationSession): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signPayload(encoded)}`;
}

function decodeSignedSession(value: string): GitHubInstallationSession | null {
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;

  const expected = signPayload(encoded);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as GitHubInstallationSession;
    if (!parsed.installationId || !parsed.accountLogin) return null;
    return parsed;
  } catch {
    return null;
  }
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export async function setInstallSessionId(sessionId: string): Promise<void> {
  const jar = await cookies();
  jar.set(INSTALL_SESSION_COOKIE, sessionId, cookieOptions(INSTALL_SESSION_MAX_AGE));
}

export async function readInstallSessionId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(INSTALL_SESSION_COOKIE)?.value ?? null;
}

export async function clearInstallSessionId(): Promise<void> {
  const jar = await cookies();
  jar.delete(INSTALL_SESSION_COOKIE);
}

export async function saveInstallationSession(session: GitHubInstallationSession): Promise<void> {
  const jar = await cookies();
  jar.set(INSTALLATION_COOKIE, encodeSignedSession(session), cookieOptions(INSTALLATION_MAX_AGE));
}

export async function readInstallationSession(): Promise<GitHubInstallationSession | null> {
  if (!isGitHubAppConfigured()) return null;
  /**
   * There is no browser cookie jar outside a request scope, and for THIS
   * function that is a legitimate state with an already-defined answer: `null`
   * means "no browser installation session", which is exactly true in a
   * background process.
   *
   * `cookies()` does not return null there — it throws. Verified live on the
   * headless seller runtime, where the deterministic A2A turn resolves a
   * GitHub App token with no HTTP request in flight: every attempt failed with
   * "`cookies` was called outside a request scope", the accepted,
   * escrow-funded job 0x22a2… retried to its 15-attempt ceiling, and the
   * deliverable was never produced.
   *
   * The caller (`resolveCleanupGitHubToken`) already handles a null session by
   * falling back to `resolveAspGitHubToken` — the documented seller-delivery
   * path for a repository where the App is installed but no Patch-tab cookie
   * exists. The throw meant that fallback was unreachable from any background
   * caller. Mapping the throw to the null it already means restores it.
   *
   * Deliberately narrow: only the absent-request-scope case becomes null. A
   * malformed or tampered cookie still fails through `decodeSignedSession`,
   * and a missing App configuration still returns null above.
   */
  let jar: Awaited<ReturnType<typeof cookies>>;
  try {
    jar = await cookies();
  } catch {
    return null;
  }
  const raw = jar.get(INSTALLATION_COOKIE)?.value;
  if (!raw) return null;
  return decodeSignedSession(raw);
}

export async function clearInstallationSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(INSTALLATION_COOKIE);
}
