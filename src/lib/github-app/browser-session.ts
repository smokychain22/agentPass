import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { jobOwnerKey } from "@/lib/jobs/types";

export const BROWSER_SESSION_COOKIE = "repodiet_browser_session";
const MAX_AGE = 60 * 60 * 24 * 365;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE,
  };
}

export async function ensureBrowserSessionId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(BROWSER_SESSION_COOKIE)?.value;
  if (existing) return existing;
  const id = randomBytes(16).toString("hex");
  jar.set(BROWSER_SESSION_COOKIE, id, cookieOptions());
  return id;
}

export async function readBrowserSessionId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(BROWSER_SESSION_COOKIE)?.value ?? null;
}

export async function buildSessionKey(request: Request): Promise<string> {
  const browserSessionId = await ensureBrowserSessionId();
  return `${jobOwnerKey(request)}:${browserSessionId}`;
}
