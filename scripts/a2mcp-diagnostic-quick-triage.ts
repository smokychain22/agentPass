/**
 * Non-billable internal diagnostic for bounded Quick Triage.
 * Does not create quotes, payments, or move funds.
 */
import { POST } from "../src/app/api/internal/a2mcp/quick-triage-diagnostic/route";

async function main() {
  process.env.NODE_ENV = process.env.NODE_ENV || "development";
  process.env.REPODIET_ALLOW_INTERNAL_DIAGNOSTIC = "1";

  const started = Date.now();
  const req = new Request("http://localhost/api/internal/a2mcp/quick-triage-diagnostic", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      repositoryUrl: "https://github.com/smokychain22/agentPass",
      branch: "main",
      maximumFindings: 5,
      operation: "analyze_repository",
    }),
  });

  const res = await POST(req);
  const json = (await res.json()) as Record<string, unknown>;
  const result = (json.result ?? (json as { data?: { result?: unknown } }).data?.result) as
    | Record<string, unknown>
    | undefined;

  const out = {
    httpStatus: res.status,
    elapsedMs: Date.now() - started,
    taskId: json.taskId ?? json.id,
    success: res.status === 200,
    summary: result?.summary ?? null,
    triageMode: result?.triageMode ?? null,
    totalMs: result?.totalMs ?? null,
    timings: result?.timings ?? null,
    error: json.error ?? null,
  };
  console.log(JSON.stringify(out, null, 2));
  if (res.status !== 200) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
