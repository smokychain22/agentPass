import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { detectPackageManager } from "@/lib/scanner/detect-package-manager";
import type { PackageManager } from "@/lib/scanner/types";
import type { VerifyCheckResult } from "@/lib/jobs/types";
import {
  ensureWorkspaceDependencies,
  nodeModulesPresent,
} from "@/lib/execution/workspace-install";

export { ensureWorkspaceDependencies } from "@/lib/execution/workspace-install";
export type { WorkspaceInstallResult } from "@/lib/execution/workspace-install";

const COMMAND_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 120_000;

export type ComparisonOutcome =
  | "passed_before_and_after"
  | "failed_before_and_after"
  | "new_failure_introduced"
  | "pre_existing_failure"
  | "pre_existing_failure_resolved"
  | "not_available"
  | "skipped"
  | "timed_out";

export interface BaselineCheck extends VerifyCheckResult {
  outcome: ComparisonOutcome | "passed" | "failed" | "unavailable" | "timeout";
  phase: "baseline" | "after";
}

const SCRIPT_CHECKS = ["typecheck", "lint", "test", "build"] as const;

function summarize(text: string, max = 400): string {
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

function installCommand(pm: PackageManager): string[] {
  switch (pm) {
    case "pnpm":
      return ["pnpm", "install", "--ignore-scripts", "--no-frozen-lockfile"];
    case "yarn":
      return ["yarn", "install", "--ignore-scripts"];
    case "bun":
      return ["bun", "install", "--ignore-scripts"];
    default:
      return ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"];
  }
}

async function runNamedCheck(
  rootDir: string,
  name: string,
  command: string[],
  phase: "baseline" | "after",
  timeoutMs = COMMAND_TIMEOUT_MS
): Promise<BaselineCheck> {
  const t0 = Date.now();
  try {
    const result = await execa(command[0], command.slice(1), {
      cwd: rootDir,
      timeout: timeoutMs,
      reject: false,
      env: { ...process.env, CI: "true", FORCE_COLOR: "0", NODE_ENV: "test" },
    });
    if (result.timedOut) {
      return {
        name,
        command: command.join(" "),
        status: "skipped",
        exitCode: null,
        durationMs: Date.now() - t0,
        stdoutSummary: "",
        stderrSummary: "Command timed out.",
        outcome: "timed_out",
        phase,
      };
    }
    const passed = result.exitCode === 0;
    return {
      name,
      command: command.join(" "),
      status: passed ? "passed" : "failed",
      exitCode: result.exitCode ?? null,
      durationMs: Date.now() - t0,
      stdoutSummary: summarize(result.stdout ?? ""),
      stderrSummary: summarize(result.stderr ?? ""),
      outcome: passed ? "passed" : "failed",
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
      outcome: "not_available",
      phase,
    };
  }
}

async function runImportValidation(rootDir: string, phase: "baseline" | "after"): Promise<BaselineCheck> {
  const t0 = Date.now();
  try {
    const raw = await fs.readFile(path.join(rootDir, "package.json"), "utf8");
    JSON.parse(raw);
    return {
      name: "import validation",
      command: "package.json parse",
      status: "passed",
      exitCode: 0,
      durationMs: Date.now() - t0,
      stdoutSummary: "package.json is valid JSON.",
      stderrSummary: "",
      outcome: "passed",
      phase,
    };
  } catch (err) {
    return {
      name: "import validation",
      command: "package.json parse",
      status: "failed",
      exitCode: 1,
      durationMs: Date.now() - t0,
      stdoutSummary: "",
      stderrSummary: err instanceof Error ? err.message : "Invalid package.json",
      outcome: "failed",
      phase,
    };
  }
}

async function runPackageIntegrity(
  rootDir: string,
  phase: "baseline" | "after",
  options?: { forceInstall?: boolean }
): Promise<BaselineCheck> {
  const pkgPath = path.join(rootDir, "package.json");
  try {
    await fs.access(pkgPath);
  } catch {
    return {
      name: "package integrity",
      command: "n/a",
      status: "skipped",
      exitCode: null,
      durationMs: 0,
      stdoutSummary: "No package.json",
      stderrSummary: "",
      outcome: "not_available",
      phase,
    };
  }

  if (!options?.forceInstall && (await nodeModulesPresent(rootDir))) {
    return {
      name: "package integrity",
      command: "node_modules present",
      status: "passed",
      exitCode: 0,
      durationMs: 0,
      stdoutSummary: "Dependencies already installed in workspace.",
      stderrSummary: "",
      outcome: "passed",
      phase,
    };
  }

  const pm = (await detectPackageManager(rootDir)).packageManager;
  return runNamedCheck(rootDir, "package integrity", installCommand(pm), phase, INSTALL_TIMEOUT_MS);
}

export interface RunFullBaselineChecksOptions {
  /** Delivery validation installs dependencies once up-front; skip redundant install checks. */
  skipPackageIntegrity?: boolean;
}

export async function runFullBaselineChecks(
  rootDir: string,
  phase: "baseline" | "after",
  options?: RunFullBaselineChecksOptions
): Promise<BaselineCheck[]> {
  const checks: BaselineCheck[] = [];
  const scripts = await readScripts(rootDir);
  const pm = (await detectPackageManager(rootDir)).packageManager;

  checks.push(await runImportValidation(rootDir, phase));

  for (const name of SCRIPT_CHECKS) {
    if (!scripts[name]) {
      checks.push({
        name,
        command: "n/a",
        status: "skipped",
        exitCode: null,
        durationMs: 0,
        stdoutSummary: "",
        stderrSummary: "Script not defined in package.json.",
        outcome: "not_available",
        phase,
      });
      continue;
    }
    checks.push(await runNamedCheck(rootDir, name, runScriptCommand(pm, name), phase));
  }

  if (!options?.skipPackageIntegrity) {
    checks.push(await runPackageIntegrity(rootDir, phase));
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
      return { ...check, outcome: check.outcome === "passed" ? "passed_before_and_after" : check.outcome };
    }

    if (before.outcome === "not_available" || check.outcome === "not_available") {
      return { ...check, outcome: "not_available" };
    }
    if (before.outcome === "timed_out" || check.outcome === "timed_out") {
      return { ...check, outcome: "timed_out" };
    }
    if (before.outcome === "skipped" || check.outcome === "skipped") {
      return { ...check, outcome: "skipped" };
    }

    const beforePassed = before.status === "passed";
    const afterPassed = check.status === "passed";

    if (beforePassed && afterPassed) {
      return { ...check, outcome: "passed_before_and_after" };
    }
    if (!beforePassed && !afterPassed) {
      const sameError =
        before.stderrSummary.slice(0, 120) === check.stderrSummary.slice(0, 120);
      return { ...check, outcome: sameError ? "failed_before_and_after" : "new_failure_introduced" };
    }
    if (beforePassed && !afterPassed) {
      return { ...check, outcome: "new_failure_introduced" };
    }
    if (!beforePassed && afterPassed) {
      return { ...check, outcome: "pre_existing_failure_resolved" };
    }
    return { ...check, outcome: "pre_existing_failure" };
  });
}

export interface BaselineVerificationReport {
  baseline: BaselineCheck[];
  after: BaselineCheck[];
  compared: BaselineCheck[];
  summary: Record<ComparisonOutcome, number>;
}

export function buildBaselineReport(
  baseline: BaselineCheck[],
  after: BaselineCheck[]
): BaselineVerificationReport {
  const compared = compareBaselineToAfter(baseline, after);
  const summary: Record<ComparisonOutcome, number> = {
    passed_before_and_after: 0,
    failed_before_and_after: 0,
    new_failure_introduced: 0,
    pre_existing_failure: 0,
    pre_existing_failure_resolved: 0,
    not_available: 0,
    skipped: 0,
    timed_out: 0,
  };
  for (const c of compared) {
    if (c.outcome in summary) {
      summary[c.outcome as ComparisonOutcome] += 1;
    }
  }
  return { baseline, after, compared, summary };
}

export function formatComparisonLabel(outcome: BaselineCheck["outcome"]): string {
  switch (outcome) {
    case "passed_before_and_after":
      return "PASSED BEFORE AND AFTER";
    case "failed_before_and_after":
      return "Pre-existing failure";
    case "new_failure_introduced":
      return "New regression";
    case "pre_existing_failure":
      return "PRE-EXISTING FAILURE";
    case "pre_existing_failure_resolved":
      return "PRE-EXISTING FAILURE RESOLVED";
    case "not_available":
      return "NOT AVAILABLE";
    case "skipped":
      return "SKIPPED";
    case "timed_out":
      return "TIMED OUT";
    case "passed":
      return "PASSED";
    case "failed":
      return "FAILED";
    default:
      return String(outcome).toUpperCase();
  }
}

export function summarizeBaselineReport(report: BaselineVerificationReport): string[] {
  const lines: string[] = ["### Baseline checks (original repository)"];
  for (const c of report.baseline) {
    lines.push(
      `- ${c.name}: exit ${c.exitCode ?? "n/a"} — ${formatComparisonLabel(c.outcome)} (${c.durationMs}ms)`
    );
  }
  lines.push("", "### Post-change checks");
  for (const c of report.after) {
    lines.push(
      `- ${c.name}: exit ${c.exitCode ?? "n/a"} — ${c.status} (${c.durationMs}ms)`
    );
  }
  lines.push("", "### Comparison");
  for (const c of report.compared) {
    lines.push(`- ${c.name}: ${formatComparisonLabel(c.outcome)}`);
  }
  return lines;
}

/** @deprecated use runFullBaselineChecks */
export const runBaselineChecks = runFullBaselineChecks;
