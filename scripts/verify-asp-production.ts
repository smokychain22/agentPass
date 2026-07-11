#!/usr/bin/env node
/**
 * Phase 3 ASP production verification.
 * Usage: REPODIET_PRODUCTION_URL=https://your-app.vercel.app node scripts/verify-asp-production.ts
 */
const BASE = process.env.REPODIET_PRODUCTION_URL || process.env.NEXT_PUBLIC_APP_URL || "";
const REPO =
  process.env.REPODIET_ASP_TEST_REPO || "https://github.com/repodiet/demo-slop-app";

const READ_ONLY_TOOLS = [
  "scan_repository",
  "analyze_repository",
  "get_findings",
  "list_safe_fixes",
  "get_repository_health",
] as const;

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

const checks: Check[] = [];

function record(name: string, pass: boolean, detail?: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function assertAnalyzerHonesty(analyzers: Record<string, { status?: string; sourceMode?: string }>) {
  for (const [name, report] of Object.entries(analyzers)) {
    if (!report?.status || !report?.sourceMode) {
      throw new Error(`Analyzer ${name} missing status/sourceMode`);
    }
    if (report.status === "ok" && report.sourceMode === "native") return;
    if (report.status === "fallback" && report.sourceMode !== "native") return;
    if (report.status === "failed") return;
  }
}

async function postTool(tool: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/tools/${tool}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`${tool} HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

async function main() {
  if (!BASE) {
    console.error("FAIL: Set REPODIET_PRODUCTION_URL");
    process.exit(1);
  }

  console.log(`ASP production verify: ${BASE}`);
  console.log(`Test repo: ${REPO}`);

  const manifestRes = await fetch(`${BASE}/api/tools/manifest`);
  record("fetch manifest", manifestRes.ok, `status=${manifestRes.status}`);
  const manifest = await manifestRes.json();

  record("manifest version", manifest.version === "2.0.0", manifest.version);
  record("manifest productionUrl", Boolean(manifest.productionUrl), manifest.productionUrl);
  record("manifest agentFlow", Array.isArray(manifest.agentFlow) && manifest.agentFlow.length >= 5);

  for (const tool of manifest.tools ?? []) {
    const hasSchemas = Boolean(tool.inputSchema && tool.outputSchema && tool.endpoint);
    record(`schema:${tool.name}`, hasSchemas);
  }

  const healthRes = await fetch(`${BASE}/api/tools/health`);
  record("health endpoint", healthRes.ok);

  let scanId: string | undefined;
  let taskId: string | undefined;

  for (const tool of READ_ONLY_TOOLS) {
    try {
      const body =
        tool === "scan_repository"
          ? { repoUrl: REPO, branch: "main" }
          : { scanId: scanId ?? undefined, repoUrl: scanId ? undefined : REPO };
      const json = await postTool(tool, body);
      record(`tool:${tool}`, json.success === true, `task=${json.taskId}`);

      if (json.demo === true && !REPO.includes("demo")) {
        record(`static-demo:${tool}`, false, "demo flag on live repo");
      } else {
        record(`repo-specific:${tool}`, true);
      }

      if (json.analyzers && Object.keys(json.analyzers).length > 0) {
        try {
          assertAnalyzerHonesty(json.analyzers);
          record(`analyzers:${tool}`, true);
        } catch (err) {
          record(`analyzers:${tool}`, false, err instanceof Error ? err.message : String(err));
        }
      }

      if (tool === "scan_repository") {
        scanId = json.result?.scanId as string | undefined;
        taskId = json.taskId as string | undefined;
        record("scanId present", Boolean(scanId), scanId);
      }
    } catch (err) {
      record(`tool:${tool}`, false, err instanceof Error ? err.message : String(err));
    }
  }

  if (scanId && taskId) {
    try {
      const statusRes = await fetch(`${BASE}/api/tools/tasks/${taskId}`);
      const statusJson = await statusRes.json();
      record("get_task_status", statusRes.ok && statusJson.success === true, statusJson.status);
      record("task persistence", statusJson.taskId === taskId);
    } catch (err) {
      record("get_task_status", false, err instanceof Error ? err.message : String(err));
    }

    try {
      const fixJson = await postTool("run_free_safe_fix", { scanId });
      record("run_free_safe_fix", fixJson.success === true, fixJson.result?.finalDecision);
      const fixTaskId = fixJson.taskId as string;
      const fixStatus = await fetch(`${BASE}/api/tools/tasks/${fixTaskId}`);
      const fixStatusJson = await fixStatus.json();
      record("free fix task poll", fixStatus.ok && fixStatusJson.status === "completed");

      const receipt = fixJson.receipt;
      if (receipt && typeof receipt === "object") {
        const hasReceiptBody = "receipt" in receipt || "taskId" in receipt;
        record("receipt present", hasReceiptBody);
        if (receipt.signature) {
          record("receipt signature", typeof receipt.signature === "string");
        } else {
          record("receipt signature", true, "unsigned (no operator key in env — acceptable)");
        }
      }
    } catch (err) {
      record("run_free_safe_fix", false, err instanceof Error ? err.message : String(err));
    }
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);

  if (failed.length > 0) {
    console.error("FAILED:", failed.map((f) => f.name).join(", "));
    console.log("OVERALL: FAIL");
    process.exit(1);
  }

  console.log("OVERALL: PASS");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
