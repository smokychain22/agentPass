import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import type { KnipRawReport } from "./types";
import { TOOL_TIMEOUT_MS, type AnalyzerRunResult } from "./types";
import { knipCliPath, knipVersion } from "./tool-paths";
import { logAnalyzer, truncateLog } from "./tool-logger";
import { runKnipFallback } from "./fallback/knip-fallback";
import { finalizeAnalyzerResult, timedAnalyzer } from "./analyzer-result";
import { analyzerChildEnv } from "./analyzer-child-env";

export async function runKnip(rootDir: string): Promise<AnalyzerRunResult<KnipRawReport>> {
  return timedAnalyzer("knip", () => runKnipInternal(rootDir));
}

async function runKnipInternal(rootDir: string): Promise<AnalyzerRunResult<KnipRawReport>> {
  const started = Date.now();
  const pkgPath = path.join(rootDir, "package.json");
  try {
    await fs.access(pkgPath);
  } catch {
    logAnalyzer("knip", "skip_no_package_json", { rootDir });
    try {
      const report = await runKnipFallback(rootDir);
      return finalizeAnalyzerResult(
        "knip",
        "fallback",
        report,
        "No package.json — used import-graph fallback.",
        Date.now() - started
      );
    } catch (err) {
      return finalizeAnalyzerResult<KnipRawReport>(
        "knip",
        "failed",
        null,
        err instanceof Error ? err.message : "Knip fallback failed.",
        Date.now() - started
      );
    }
  }

  const cli = knipCliPath();
  try {
    await fs.access(cli);
  } catch (err) {
    logAnalyzer("knip", "cli_missing", {
      cli,
      error: err instanceof Error ? err.message : String(err),
    });
    return runKnipFallbackWrapped(rootDir, "Knip CLI not found in node_modules.", started);
  }

  try {
    const result = await execa(process.execPath, [cli, "--reporter", "json", "--no-progress"], {
      cwd: rootDir,
      timeout: TOOL_TIMEOUT_MS,
      reject: false,
      env: analyzerChildEnv(),
    });

    logAnalyzer("knip", "cli_finished", {
      exitCode: result.exitCode,
      stdoutLen: result.stdout?.length ?? 0,
      stderr: truncateLog(result.stderr),
      cli,
      rootDir,
    });

    if (result.stdout?.trim()) {
      try {
        const report = JSON.parse(result.stdout) as KnipRawReport;
        return finalizeAnalyzerResult("knip", "ok", report, undefined, Date.now() - started, knipVersion());
      } catch (parseErr) {
        logAnalyzer("knip", "json_parse_error", {
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
          stdoutHead: truncateLog(result.stdout, 200),
        });
      }
    }

    return runKnipFallbackWrapped(
      rootDir,
      result.stderr || `Knip exited ${result.exitCode} with no JSON output.`,
      started
    );
  } catch (err) {
    logAnalyzer("knip", "cli_exception", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? truncateLog(err.stack, 400) : undefined,
    });
    return runKnipFallbackWrapped(
      rootDir,
      err instanceof Error ? err.message : "Knip failed.",
      started
    );
  }
}

async function runKnipFallbackWrapped(
  rootDir: string,
  reason: string,
  started: number
): Promise<AnalyzerRunResult<KnipRawReport>> {
  try {
    logAnalyzer("knip", "fallback_start", { rootDir, reason });
    const report = await runKnipFallback(rootDir);
    logAnalyzer("knip", "fallback_ok", {
      issues: report.issues?.length ?? 0,
    });
    return finalizeAnalyzerResult("knip", "fallback", report, reason, Date.now() - started);
  } catch (err) {
    logAnalyzer("knip", "fallback_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return finalizeAnalyzerResult<KnipRawReport>(
      "knip",
      "failed",
      null,
      err instanceof Error ? err.message : "Knip fallback failed.",
      Date.now() - started
    );
  }
}
