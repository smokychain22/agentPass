import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import type { JscpdRawReport } from "./types";
import { TOOL_TIMEOUT_MS, type AnalyzerRunResult } from "./types";
import { jscpdCliPath } from "./tool-paths";
import { logAnalyzer, truncateLog } from "./tool-logger";
import { runDuplicateFallback } from "./fallback/duplicate-detector";

export async function runJscpd(rootDir: string): Promise<AnalyzerRunResult<JscpdRawReport>> {
  const outDir = path.join(rootDir, ".repodiet-jscpd");
  await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});

  const cli = jscpdCliPath();
  try {
    await fs.access(cli);
  } catch (err) {
    logAnalyzer("jscpd", "cli_missing", {
      cli,
      error: err instanceof Error ? err.message : String(err),
    });
    return runJscpdFallbackWrapped(rootDir, "jscpd CLI not found in node_modules.");
  }

  try {
    const result = await execa(
      process.execPath,
      [
        cli,
        "--pattern",
        "**/*.{js,ts,tsx,jsx,mjs,cjs}",
        "--ignore",
        "**/node_modules/**,**/.next/**,**/dist/**,**/build/**,**/coverage/**,**/.cache/**,**/.repodiet-jscpd/**",
        "--min-lines",
        "4",
        "--min-tokens",
        "35",
        "--reporters",
        "json",
        "--output",
        outDir,
        "--absolute",
        rootDir,
      ],
      {
        cwd: rootDir,
        timeout: TOOL_TIMEOUT_MS,
        reject: false,
        env: { ...process.env, FORCE_COLOR: "0" },
      }
    );

    logAnalyzer("jscpd", "cli_finished", {
      exitCode: result.exitCode,
      stderr: truncateLog(result.stderr),
      stdout: truncateLog(result.stdout),
      cli,
      rootDir,
    });

    const reportPaths = [
      path.join(outDir, "jscpd-report.json"),
      path.join(rootDir, "report", "jscpd-report.json"),
    ];

    for (const reportPath of reportPaths) {
      try {
        const raw = await fs.readFile(reportPath, "utf8");
        const report = JSON.parse(raw) as JscpdRawReport;
        await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
        return { status: "ok", report };
      } catch {
        /* try next path */
      }
    }

    await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
    return runJscpdFallbackWrapped(
      rootDir,
      result.stderr || `jscpd exited ${result.exitCode} without report.`
    );
  } catch (err) {
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
    logAnalyzer("jscpd", "cli_exception", {
      error: err instanceof Error ? err.message : String(err),
    });
    return runJscpdFallbackWrapped(rootDir, err instanceof Error ? err.message : "jscpd failed.");
  }
}

async function runJscpdFallbackWrapped(
  rootDir: string,
  reason: string
): Promise<AnalyzerRunResult<JscpdRawReport>> {
  try {
    logAnalyzer("jscpd", "fallback_start", { rootDir, reason });
    const report = await runDuplicateFallback(rootDir);
    logAnalyzer("jscpd", "fallback_ok", {
      duplicates: report.duplicates?.length ?? 0,
    });
    return { status: "fallback", report, error: reason };
  } catch (err) {
    logAnalyzer("jscpd", "fallback_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      status: "failed",
      report: null,
      error: err instanceof Error ? err.message : "jscpd fallback failed.",
    };
  }
}
