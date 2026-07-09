import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import type { KnipRawReport } from "./types";
import { TOOL_TIMEOUT_MS, type AnalyzerRunResult } from "./types";
import { knipCliPath } from "./tool-paths";
import { logAnalyzer, truncateLog } from "./tool-logger";
import { runKnipFallback } from "./fallback/knip-fallback";

export async function runKnip(rootDir: string): Promise<AnalyzerRunResult<KnipRawReport>> {
  const pkgPath = path.join(rootDir, "package.json");
  try {
    await fs.access(pkgPath);
  } catch {
    logAnalyzer("knip", "skip_no_package_json", { rootDir });
    try {
      const report = await runKnipFallback(rootDir);
      return { status: "fallback", report, error: "No package.json — used import-graph fallback." };
    } catch (err) {
      return {
        status: "failed",
        report: null,
        error: err instanceof Error ? err.message : "Knip fallback failed.",
      };
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
    return runKnipFallbackWrapped(rootDir, "Knip CLI not found in node_modules.");
  }

  try {
    const result = await execa(process.execPath, [cli, "--reporter", "json", "--no-progress"], {
      cwd: rootDir,
      timeout: TOOL_TIMEOUT_MS,
      reject: false,
      env: { ...process.env, FORCE_COLOR: "0" },
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
        return { status: "ok", report };
      } catch (parseErr) {
        logAnalyzer("knip", "json_parse_error", {
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
          stdoutHead: truncateLog(result.stdout, 200),
        });
      }
    }

    return runKnipFallbackWrapped(
      rootDir,
      result.stderr || `Knip exited ${result.exitCode} with no JSON output.`
    );
  } catch (err) {
    logAnalyzer("knip", "cli_exception", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? truncateLog(err.stack, 400) : undefined,
    });
    return runKnipFallbackWrapped(rootDir, err instanceof Error ? err.message : "Knip failed.");
  }
}

async function runKnipFallbackWrapped(
  rootDir: string,
  reason: string
): Promise<AnalyzerRunResult<KnipRawReport>> {
  try {
    logAnalyzer("knip", "fallback_start", { rootDir, reason });
    const report = await runKnipFallback(rootDir);
    logAnalyzer("knip", "fallback_ok", {
      issues: report.issues?.length ?? 0,
    });
    return { status: "fallback", report, error: reason };
  } catch (err) {
    logAnalyzer("knip", "fallback_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      status: "failed",
      report: null,
      error: err instanceof Error ? err.message : "Knip fallback failed.",
    };
  }
}
