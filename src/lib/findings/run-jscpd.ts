import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import type { JscpdRawReport } from "./types";
import { TOOL_TIMEOUT_MS, type AnalyzerRunResult } from "./types";
import { jscpdCliPath } from "./tool-paths";
import { logAnalyzer, truncateLog } from "./tool-logger";
import { runDuplicateFallback } from "./fallback/duplicate-detector";
import { finalizeAnalyzerResult, timedAnalyzer } from "./analyzer-result";
import { analyzerChildEnv } from "./analyzer-child-env";

export async function runJscpd(rootDir: string): Promise<AnalyzerRunResult<JscpdRawReport>> {
  return timedAnalyzer("jscpd", () => runJscpdInternal(rootDir));
}

async function runJscpdInternal(rootDir: string): Promise<AnalyzerRunResult<JscpdRawReport>> {
  const started = Date.now();
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
    return runJscpdFallbackWrapped(rootDir, "jscpd CLI not found in node_modules.", started);
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
        env: analyzerChildEnv(),
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
        return finalizeAnalyzerResult("jscpd", "ok", report, undefined, Date.now() - started);
      } catch {
        /* try next path */
      }
    }

    await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
    return runJscpdFallbackWrapped(
      rootDir,
      result.stderr || `jscpd exited ${result.exitCode} without report.`,
      started
    );
  } catch (err) {
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
    logAnalyzer("jscpd", "cli_exception", {
      error: err instanceof Error ? err.message : String(err),
    });
    return runJscpdFallbackWrapped(
      rootDir,
      err instanceof Error ? err.message : "jscpd failed.",
      started
    );
  }
}

async function runJscpdFallbackWrapped(
  rootDir: string,
  reason: string,
  started: number
): Promise<AnalyzerRunResult<JscpdRawReport>> {
  try {
    logAnalyzer("jscpd", "fallback_start", { rootDir, reason });
    const report = await runDuplicateFallback(rootDir);
    logAnalyzer("jscpd", "fallback_ok", {
      duplicates: report.duplicates?.length ?? 0,
    });
    return finalizeAnalyzerResult("jscpd", "fallback", report, reason, Date.now() - started);
  } catch (err) {
    logAnalyzer("jscpd", "fallback_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return finalizeAnalyzerResult<JscpdRawReport>(
      "jscpd",
      "failed",
      null,
      err instanceof Error ? err.message : "jscpd fallback failed.",
      Date.now() - started
    );
  }
}
