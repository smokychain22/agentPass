import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import type { MadgeRawReport } from "./types";
import { TOOL_TIMEOUT_MS, type AnalyzerRunResult } from "./types";
import { madgeScriptPath } from "./tool-paths";
import { logAnalyzer, truncateLog } from "./tool-logger";
import { runMadgeFallback } from "./fallback/madge-fallback";

async function resolveEntry(rootDir: string): Promise<string> {
  const candidates = [
    "src/index.ts",
    "src/index.tsx",
    "src/main.ts",
    "index.ts",
    "index.js",
    "app/page.tsx",
    "pages/index.tsx",
  ];
  for (const c of candidates) {
    try {
      await fs.access(path.join(rootDir, c));
      return path.join(rootDir, c);
    } catch {
      /* next */
    }
  }
  return rootDir;
}

export async function runMadge(rootDir: string): Promise<AnalyzerRunResult<MadgeRawReport>> {
  const scriptPath = madgeScriptPath();
  const entry = await resolveEntry(rootDir);

  try {
    await fs.access(scriptPath);
  } catch (err) {
    logAnalyzer("madge", "script_missing", {
      scriptPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return runMadgeFallbackWrapped(rootDir, "Madge script not found.");
  }

  try {
    const result = await execa(process.execPath, [scriptPath, rootDir, entry], {
      timeout: TOOL_TIMEOUT_MS,
      reject: false,
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    logAnalyzer("madge", "cli_finished", {
      exitCode: result.exitCode,
      stderr: truncateLog(result.stderr),
      stdoutLen: result.stdout?.length ?? 0,
      scriptPath,
      entry,
      rootDir,
    });

    if (result.exitCode === 0 && result.stdout?.trim()) {
      try {
        const report = JSON.parse(result.stdout) as MadgeRawReport;
        return { status: "ok", report };
      } catch (parseErr) {
        logAnalyzer("madge", "json_parse_error", {
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
        });
      }
    }

    let errMsg = result.stderr || `Madge exited ${result.exitCode}.`;
    try {
      const parsed = JSON.parse(result.stderr) as { error?: string };
      if (parsed.error) errMsg = parsed.error;
    } catch {
      /* use stderr */
    }

    return runMadgeFallbackWrapped(rootDir, errMsg);
  } catch (err) {
    logAnalyzer("madge", "cli_exception", {
      error: err instanceof Error ? err.message : String(err),
    });
    return runMadgeFallbackWrapped(rootDir, err instanceof Error ? err.message : "Madge failed.");
  }
}

async function runMadgeFallbackWrapped(
  rootDir: string,
  reason: string
): Promise<AnalyzerRunResult<MadgeRawReport>> {
  try {
    logAnalyzer("madge", "fallback_start", { rootDir, reason });
    const report = await runMadgeFallback(rootDir);
    logAnalyzer("madge", "fallback_ok", {
      orphans: report.orphans.length,
      circular: report.circular.length,
    });
    return { status: "fallback", report, error: reason };
  } catch (err) {
    logAnalyzer("madge", "fallback_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      status: "failed",
      report: null,
      error: err instanceof Error ? err.message : "Madge fallback failed.",
    };
  }
}
