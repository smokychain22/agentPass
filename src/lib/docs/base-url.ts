import { REPODIET_PRODUCTION_FALLBACK_URL } from "@/lib/app/production-url";

export function getServerBaseUrl(): string {
  // On Vercel Preview, prefer the deployment host so advertised status/progress
  // URLs stay on the same deployment that accepted the task.
  const previewHost =
    process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL.trim()}`
      : undefined;

  const candidates = [
    previewHost,
    process.env.NEXT_PUBLIC_APP_URL?.trim(),
    process.env.REPODIET_APP_URL?.trim(),
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.trim()}` : undefined,
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const normalized = candidate.replace(/\/$/, "");
    try {
      const hostname = new URL(normalized).hostname;
      if (hostname !== "github.com" && !hostname.endsWith(".github.com")) {
        return normalized;
      }
    } catch {
      // ignore invalid candidate
    }
  }

  return REPODIET_PRODUCTION_FALLBACK_URL;
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
