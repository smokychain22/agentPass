const REPODIET_APP_FALLBACK = "https://skillswap-skillswap7.vercel.app";

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

export function isGitHubWebsiteUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "github.com" || parsed.hostname.endsWith(".github.com");
  } catch {
    return false;
  }
}

export function isRepodietAppBaseUrl(url: string): boolean {
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
  return !isGitHubWebsiteUrl(url);
}

export function getAppBaseUrl(): string {
  const candidates = [
    readEnv("NEXT_PUBLIC_APP_URL"),
    readEnv("REPODIET_APP_URL"),
    readEnv("VERCEL_URL") ? `https://${readEnv("VERCEL_URL")}` : undefined,
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (isRepodietAppBaseUrl(normalized)) {
      return normalized;
    }
  }

  const misconfigured = readEnv("GITHUB_APP_PUBLIC_URL");
  if (misconfigured && isGitHubWebsiteUrl(misconfigured)) {
    console.warn(
      "[repodiet-app-base-url] Ignoring GITHUB_APP_PUBLIC_URL for RepoDiet redirects because it points to github.com."
    );
  }

  return REPODIET_APP_FALLBACK;
}

export function resolveRepodietReturnUrl(returnPath?: string, scanId?: string): URL {
  const appBase = getAppBaseUrl();
  const trimmed = returnPath?.trim();

  if (trimmed?.startsWith("http://") || trimmed?.startsWith("https://")) {
    const absolute = new URL(trimmed);
    if (isRepodietAppBaseUrl(absolute.origin)) {
      if (scanId && !absolute.searchParams.has("scanId")) {
        absolute.searchParams.set("scanId", scanId);
      }
      return absolute;
    }
  }

  const relativePath = trimmed && !isGitHubWebsiteUrl(trimmed) ? trimmed : "/app?tab=patch";
  const url = new URL(
    relativePath.startsWith("/") ? relativePath : `/${relativePath}`,
    `${appBase}/`
  );

  if (scanId && !url.searchParams.has("scanId")) {
    url.searchParams.set("scanId", scanId);
  }

  return url;
}
