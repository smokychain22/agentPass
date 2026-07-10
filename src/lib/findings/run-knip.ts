import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import type { KnipRawReport } from "./types";
import { TOOL_TIMEOUT_MS, type AnalyzerRunResult } from "./types";
import { knipCliPath, knipVersion } from "./tool-paths";
import { logAnalyzer, truncateLog } from "./tool-logger";
import { finalizeAnalyzerResult, timedAnalyzer } from "./analyzer-result";
import { isKnipOomError, knipChildEnv } from "./analyzer-child-env";

export async function runKnip(rootDir: string): Promise<AnalyzerRunResult<KnipRawReport>> {
  return timedAnalyzer("knip", () => runKnipInternal(rootDir));
}

interface KnipAttempt {
  args: string[];
  label: string;
}

function knipAttempts(): KnipAttempt[] {
  return [
    { label: "default", args: ["--reporter", "json", "--no-progress"] },
    { label: "production", args: ["--reporter", "json", "--no-progress", "--production"] },
  ];
}

async function runKnipCli(
  cli: string,
  rootDir: string,
  args: string[]
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const result = await execa(process.execPath, [cli, ...args], {
    cwd: rootDir,
    timeout: TOOL_TIMEOUT_MS,
    reject: false,
    env: knipChildEnv(),
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseKnipStdout(stdout: string): KnipRawReport | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as KnipRawReport;
  } catch {
    return null;
  }
}

async function runKnipInternal(rootDir: string): Promise<AnalyzerRunResult<KnipRawReport>> {
  const started = Date.now();
  const pkgPath = path.join(rootDir, "package.json");
  try {
    await fs.access(pkgPath);
  } catch {
    logAnalyzer("knip", "skip_no_package_json", { rootDir });
    return finalizeAnalyzerResult<KnipRawReport>(
      "knip",
      "failed",
      null,
      "No package.json — Knip cannot run natively.",
      Date.now() - started
    );
  }

  const cli = knipCliPath();
  try {
    await fs.access(cli);
  } catch (err) {
    logAnalyzer("knip", "cli_missing", {
      cli,
      error: err instanceof Error ? err.message : String(err),
    });
    return finalizeAnalyzerResult<KnipRawReport>(
      "knip",
      "failed",
      null,
      "Knip CLI not found in node_modules.",
      Date.now() - started
    );
  }

  let lastError = "Knip produced no JSON output.";
  for (const attempt of knipAttempts()) {
    try {
      const result = await runKnipCli(cli, rootDir, attempt.args);
      logAnalyzer("knip", "cli_finished", {
        attempt: attempt.label,
        exitCode: result.exitCode,
        stdoutLen: result.stdout.length,
        stderr: truncateLog(result.stderr),
        cli,
        rootDir,
        rawTransferDisabled: true,
      });

      const report = parseKnipStdout(result.stdout);
      if (report) {
        const note =
          attempt.label === "production"
            ? "Ran in --production mode after default attempt needed narrower scope."
            : undefined;
        return finalizeAnalyzerResult("knip", "ok", report, note, Date.now() - started, knipVersion());
      }

      const combined = `${result.stderr}\n${result.stdout}`;
      if (isKnipOomError(combined)) {
        lastError = "Knip OOM during oxc-parser raw transfer (retrying with safer settings).";
        logAnalyzer("knip", "oom_detected", { attempt: attempt.label, rootDir });
        continue;
      }

      lastError = result.stderr || `Knip exited ${result.exitCode} with no JSON output.`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logAnalyzer("knip", "cli_exception", {
        attempt: attempt.label,
        error: message,
        stack: err instanceof Error ? truncateLog(err.stack, 400) : undefined,
      });
      lastError = message;
      if (isKnipOomError(message)) continue;
    }
  }

  return finalizeAnalyzerResult<KnipRawReport>(
    "knip",
    "failed",
    null,
    lastError,
    Date.now() - started,
    knipVersion()
  );
}
