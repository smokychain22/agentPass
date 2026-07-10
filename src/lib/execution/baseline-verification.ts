import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { detectPackageManager } from "@/lib/scanner/detect-package-manager";
import type { PackageManager } from "@/lib/scanner/types";
import type { VerifyCheckResult } from "@/lib/jobs/types";

const COMMAND_TIMEOUT_MS = 45_000;

export type VerificationOutcome =
  | "passed"
  | "failed"
  | "pre_existing_failure"
  | "introduced_failure"
  | "unavailable"
  | "skipped"
  | "timeout";

export interface BaselineCheck extends VerifyCheckResult {
  outcome: VerificationOutcome;
  phase: "baseline" | "after";
}

const SCRIPT_PRIORITY = ["typecheck", "build", "lint"] as const;

function summarize(text: string, max = 300): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

async function readScripts(rootDir: string): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(path.join(rootDir, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

function runScriptCommand(pm: PackageManager, name: string): string[] {
  switch (pm) {
    case "pnpm":
      return ["pnpm", "run", name];
    case "yarn":
      return ["yarn", name];
    case "bun":
      return ["bun", "run", name];
    default:
      return ["npm", "run", name];
  }
}

async function runNamedCheck(
  rootDir: string,
  name: string,
  command: string[],
  phase: "baseline" | "after"
): Promise<BaselineCheck> {
  const t0 = Date.now();
  try {
    const result = await execa(command[0], command.slice(1), {
      cwd: rootDir,
      timeout: COMMAND_TIMEOUT_MS,
      reject: false,
      env: { ...process.env, CI: "true", FORCE_COLOR: "0", NODE_ENV: "test" },
    });
    const status = result.timedOut
      ? "timeout"
      : result.exitCode === 0
        ? "passed"
        : "failed";
    return {
      name,
      command: command.join(" "),
      status: status === "timeout" ? "skipped" : status === "passed" ? "passed" : "failed",
      exitCode: result.exitCode ?? null,
      durationMs: Date.now() - t0,
      stdoutSummary: summarize(result.stdout ?? ""),
      stderrSummary: summarize(result.stderr ?? ""),
      outcome: status === "timeout" ? "timeout" : status,
      phase,
    };
  } catch {
    return {
      name,
      command: command.join(" "),
      status: "skipped",
      exitCode: null,
      durationMs: Date.now() - t0,
      stdoutSummary: "",
      stderrSummary: "Check could not be executed.",
      outcome: "unavailable",
      phase,
    };
  }
}

export async function runBaselineChecks(rootDir: string): Promise<BaselineCheck[]> {
  const checks: BaselineCheck[] = [];
  const scripts = await readScripts(rootDir);
  if (Object.keys(scripts).length === 0) {
    return checks;
  }

  const pm = (await detectPackageManager(rootDir)).packageManager;
  for (const name of SCRIPT_PRIORITY) {
    if (!scripts[name]) continue;
    checks.push(await runNamedCheck(rootDir, name, runScriptCommand(pm, name), "baseline"));
  }
  return checks;
}

export function compareBaselineToAfter(
  baseline: BaselineCheck[],
  after: BaselineCheck[]
): BaselineCheck[] {
  const baselineByName = new Map(baseline.map((c) => [c.name, c]));
  return after.map((check) => {
    const before = baselineByName.get(check.name);
    if (!before) {
      return { ...check, outcome: check.status === "passed" ? "passed" : check.outcome };
    }
    if (before.status === "failed" && check.status === "failed") {
      const sameError =
        before.stderrSummary.slice(0, 120) === check.stderrSummary.slice(0, 120);
      return {
        ...check,
        outcome: sameError ? "pre_existing_failure" : "introduced_failure",
      };
    }
    if (before.status === "passed" && check.status === "failed") {
      return { ...check, outcome: "introduced_failure" };
    }
    if (check.status === "passed") {
      return { ...check, outcome: "passed" };
    }
    return check;
  });
}

export interface BaselineVerificationReport {
  baseline: BaselineCheck[];
  after: BaselineCheck[];
  compared: BaselineCheck[];
  summary: {
    introducedFailures: number;
    preExistingFailures: number;
    passed: number;
    unavailable: number;
  };
}

export function summarizeBaselineReport(report: BaselineVerificationReport): string[] {
  const lines: string[] = [];
  if (report.baseline.length === 0) {
    lines.push("No package scripts available for baseline verification.");
    return lines;
  }
  lines.push("### Original repository");
  for (const c of report.baseline) {
    lines.push(`- ${c.name}: ${c.status === "passed" ? "passed" : c.status === "failed" ? "failed" : c.outcome}`);
  }
  lines.push("", "### After fix");
  for (const c of report.compared) {
    const label =
      c.outcome === "pre_existing_failure"
        ? "still failing (pre-existing)"
        : c.outcome === "introduced_failure"
          ? "failed (introduced by change)"
          : c.outcome;
    lines.push(`- ${c.name}: ${label}`);
  }
  return lines;
}
