const FALLBACK_BASE_URL = "https://skillswap-skillswap7.vercel.app";

export function getServerBaseUrl(): string {
  const explicit =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.GITHUB_APP_PUBLIC_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return FALLBACK_BASE_URL;
}

export function buildToolCurl(
  baseUrl: string,
  endpoint: string,
  body: Record<string, unknown>
): string {
  const url = `${baseUrl.replace(/\/$/, "")}${endpoint}`;

  return `curl -X POST ${url} \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(body)}'`;
}
