export type ToolStatus = "ok" | "fallback" | "failed";

export function logAnalyzer(
  tool: string,
  event: string,
  details: Record<string, unknown> = {}
): void {
  console.error(
    JSON.stringify({
      repodiet: "analyzer",
      tool,
      event,
      at: new Date().toISOString(),
      cwd: process.cwd(),
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      ...details,
    })
  );
}

export function truncateLog(value: string | undefined, max = 800): string | undefined {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
