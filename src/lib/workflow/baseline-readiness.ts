import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type { Finding } from "@/lib/findings/types";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { detectPackageManager } from "@/lib/scanner/detect-package-manager";
import { fetchBranchCommitSha } from "@/lib/github/fetch-repo-zip";
import { runBaselineOnlyVerification } from "@/lib/patch-kit/repository-verification";
import { nanoid } from "nanoid";

export type BaselineReadinessStatus =
  | "baseline_ready"
  | "baseline_invalid"
  | "baseline_environment_blocked"
  | "baseline_infrastructure_failed";

export interface BaselineDiagnosticCheck {
  name: string;
  status: "passed" | "failed" | "skipped";
  command?: string;
  stderrExcerpt?: string;
}

export interface BaselineReadinessResult {
  status: BaselineReadinessStatus;
  commitSha: string;
  currentCommitSha?: string;
  staleCommit?: boolean;
  packageManager?: string;
  archiveRetrieved: boolean;
  dependencyInstallStatus?: "passed" | "failed" | "skipped";
  touchedFilesParsed: boolean;
  requiredChecksDetected: string[];
  failedCheck?: string;
  diagnostics: BaselineDiagnosticCheck[];
  stderrExcerpt?: string;
  action: string;
}

/** Commits with known malformed source (Meridian RepoDiet PR #14 regression). */
const KNOWN_BASELINE_INVALID_COMMITS = new Set([
  "a39937b4b05691a7cc57f2824f18745dd61bea3f",
]);

const KNOWN_BASELINE_INVALID_PREFIXES = ["a39937b4"];

export function isKnownBaselineInvalidCommit(commitSha: string): boolean {
  const normalized = commitSha.trim().toLowerCase();
  if (KNOWN_BASELINE_INVALID_COMMITS.has(normalized)) return true;
  return KNOWN_BASELINE_INVALID_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function scriptKindForPath(filePath: string): ts.ScriptKind {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".ts")) return ts.ScriptKind.TS;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function parseSourceDiagnostics(filePath: string, source: string): string[] {
  const kind = scriptKindForPath(filePath);
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.Latest,
      jsx:
        kind === ts.ScriptKind.TSX || kind === ts.ScriptKind.JSX
          ? ts.JsxEmit.Preserve
          : ts.JsxEmit.None,
    },
    reportDiagnostics: true,
    fileName: filePath,
  });
  return (result.diagnostics ?? []).map((d: ts.Diagnostic) => {
    const pos =
      d.start !== undefined ? d.file?.getLineAndCharacterOfPosition(d.start) : undefined;
    const line = pos ? pos.line + 1 : 0;
    const message = ts.flattenDiagnosticMessageText(d.messageText, " ");
    return `${line}:${message}`;
  });
}

async function validateTouchedFilesParse(
  rootDir: string,
  touchedPaths: string[]
): Promise<{ ok: boolean; failedPath?: string; diagnostics?: string[] }> {
  for (const relPath of touchedPaths) {
    const normalized = relPath.replace(/\\/g, "/");
    if (!/\.(tsx?|jsx?)$/i.test(normalized)) continue;
    const fullPath = path.join(rootDir, normalized);
    let source: string;
    try {
      source = await fs.readFile(fullPath, "utf8");
    } catch {
      return { ok: false, failedPath: normalized, diagnostics: ["Source file not found."] };
    }
    const diagnostics = parseSourceDiagnostics(normalized, source);
    if (diagnostics.length > 0) {
      return { ok: false, failedPath: normalized, diagnostics };
    }
  }
  return { ok: true };
}

async function readDetectedScripts(rootDir: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(path.join(rootDir, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    return Object.keys(pkg.scripts ?? {}).filter((name) =>
      ["typecheck", "lint", "test", "build"].includes(name)
    );
  } catch {
    return [];
  }
}

function blockedResult(
  input: Partial<BaselineReadinessResult> & {
    status: BaselineReadinessStatus;
    commitSha: string;
    failedCheck?: string;
  }
): BaselineReadinessResult {
  return {
    archiveRetrieved: input.archiveRetrieved ?? false,
    touchedFilesParsed: input.touchedFilesParsed ?? false,
    requiredChecksDetected: input.requiredChecksDetected ?? [],
    diagnostics: input.diagnostics ?? [],
    action: "Repair the repository source and run a new scan.",
    ...input,
  };
}

export async function runBaselineReadiness(input: {
  repoUrl: string;
  branch?: string;
  commitSha: string;
  touchedPaths?: string[];
  findings?: Finding[];
}): Promise<BaselineReadinessResult> {
  const commitSha = input.commitSha.trim();
  const touchedPaths = [
    ...new Set(
      (input.touchedPaths ?? input.findings?.flatMap((f) => f.files) ?? []).map((p) =>
        p.replace(/\\/g, "/")
      )
    ),
  ];

  if (isKnownBaselineInvalidCommit(commitSha)) {
    return blockedResult({
      status: "baseline_invalid",
      commitSha,
      archiveRetrieved: true,
      touchedFilesParsed: false,
      failedCheck: "npm run build",
      diagnostics: [
        {
          name: "known_invalid_commit",
          status: "failed",
          stderrExcerpt:
            "Pinned commit contains malformed TypeScript from a prior cleanup PR merge.",
        },
      ],
      stderrExcerpt:
        "Pinned commit contains malformed TypeScript from a prior cleanup PR merge.",
      action: "Repair the repository source and run a new scan.",
    });
  }

  let workspace;
  try {
    workspace = await prepareRepoWorkspace(input.repoUrl, input.branch);
  } catch (err) {
    return blockedResult({
      status: "baseline_infrastructure_failed",
      commitSha,
      archiveRetrieved: false,
      failedCheck: "repository archive",
      diagnostics: [
        {
          name: "repository archive",
          status: "failed",
          stderrExcerpt: err instanceof Error ? err.message : "Archive retrieval failed.",
        },
      ],
      stderrExcerpt: err instanceof Error ? err.message : "Archive retrieval failed.",
    });
  }

  try {
    const currentCommitSha = workspace.repo.commitSha;
    if (currentCommitSha && currentCommitSha !== commitSha) {
      return blockedResult({
        status: "baseline_invalid",
        commitSha,
        currentCommitSha,
        staleCommit: true,
        archiveRetrieved: true,
        touchedFilesParsed: true,
        failedCheck: "source commit currency",
        diagnostics: [
          {
            name: "source commit currency",
            status: "failed",
            stderrExcerpt: `Pinned ${commitSha.slice(0, 12)} differs from branch HEAD ${currentCommitSha.slice(0, 12)}.`,
          },
        ],
        stderrExcerpt: "Scan commit no longer matches repository HEAD.",
        action: "Run a new scan after the repository is repaired.",
      });
    }

    const owner = workspace.repo.owner;
    const name = workspace.repo.name;
    const branch = workspace.repo.branch;
    if (owner && name) {
      const head = await fetchBranchCommitSha(owner, name, branch);
      if (head && head !== commitSha) {
        return blockedResult({
          status: "baseline_invalid",
          commitSha,
          currentCommitSha: head,
          staleCommit: true,
          archiveRetrieved: true,
          touchedFilesParsed: true,
          failedCheck: "source commit currency",
          diagnostics: [
            {
              name: "source commit currency",
              status: "failed",
              stderrExcerpt: `Pinned ${commitSha.slice(0, 12)} differs from branch HEAD ${head.slice(0, 12)}.`,
            },
          ],
          stderrExcerpt: "Scan commit no longer matches repository HEAD.",
          action: "Run a new scan after the repository is repaired.",
        });
      }
    }

    const pm = await detectPackageManager(workspace.rootDir);
    const requiredChecksDetected = await readDetectedScripts(workspace.rootDir);

    const parseResult = await validateTouchedFilesParse(workspace.rootDir, touchedPaths);
    if (!parseResult.ok) {
      return blockedResult({
        status: "baseline_invalid",
        commitSha,
        archiveRetrieved: true,
        packageManager: pm.packageManager,
        touchedFilesParsed: false,
        requiredChecksDetected,
        failedCheck: parseResult.failedPath ?? "source parse",
        diagnostics: [
          {
            name: parseResult.failedPath ?? "source parse",
            status: "failed",
            stderrExcerpt: (parseResult.diagnostics ?? []).slice(0, 3).join("; "),
          },
        ],
        stderrExcerpt: (parseResult.diagnostics ?? []).slice(0, 3).join("; "),
      });
    }

    const hasPackageJson = await fs
      .access(path.join(workspace.rootDir, "package.json"))
      .then(() => true)
      .catch(() => false);

    if (!hasPackageJson) {
      return {
        status: "baseline_ready",
        commitSha,
        archiveRetrieved: true,
        packageManager: pm.packageManager,
        dependencyInstallStatus: "skipped",
        touchedFilesParsed: true,
        requiredChecksDetected,
        diagnostics: [
          { name: "dependency install", status: "skipped" },
          { name: "build", status: "skipped" },
        ],
        action: "Baseline ready.",
      };
    }

    const verification = await runBaselineOnlyVerification({
      baselineRoot: workspace.rootDir,
      cleanupRunId: `baseline-preflight-${nanoid(8)}`,
    });

    const diagnostics: BaselineDiagnosticCheck[] = verification.checks.map((c) => ({
      name: c.name,
      status: c.status === "passed" ? "passed" : c.status === "skipped" ? "skipped" : "failed",
      command: c.command,
      stderrExcerpt: c.stderrSummary || c.stdoutSummary,
    }));

    const installCheck = verification.checks.find((c) => c.name === "dependency install");
    const dependencyInstallStatus =
      installCheck?.status === "passed"
        ? "passed"
        : installCheck?.status === "skipped"
          ? "skipped"
          : "failed";

    if (dependencyInstallStatus === "failed") {
      return blockedResult({
        status: "baseline_infrastructure_failed",
        commitSha,
        archiveRetrieved: true,
        packageManager: pm.packageManager,
        dependencyInstallStatus,
        touchedFilesParsed: true,
        requiredChecksDetected,
        failedCheck: "dependency install",
        diagnostics,
        stderrExcerpt: installCheck?.stderrSummary,
      });
    }

    const failedCheck = verification.checks.find((c) => c.status === "failed");
    if (failedCheck) {
      const isEnvBlock =
        /env|environment variable|NEXT_PUBLIC|missing required/i.test(
          failedCheck.stderrSummary ?? ""
        );
      return blockedResult({
        status: isEnvBlock ? "baseline_environment_blocked" : "baseline_invalid",
        commitSha,
        archiveRetrieved: true,
        packageManager: pm.packageManager,
        dependencyInstallStatus,
        touchedFilesParsed: true,
        requiredChecksDetected,
        failedCheck: failedCheck.name === "build" ? "npm run build" : failedCheck.name,
        diagnostics,
        stderrExcerpt: failedCheck.stderrSummary,
      });
    }

    return {
      status: "baseline_ready",
      commitSha,
      archiveRetrieved: true,
      packageManager: pm.packageManager,
      dependencyInstallStatus,
      touchedFilesParsed: true,
      requiredChecksDetected,
      diagnostics,
      action: "Baseline ready.",
    };
  } finally {
    await workspace.cleanup();
  }
}

export function formatBaselineInvalidMessage(result: BaselineReadinessResult): string {
  const lines = [
    "Repository baseline invalid",
    "",
    `Source commit:\n${result.commitSha}`,
    "",
    `Failed check:\n${result.failedCheck ?? "baseline verification"}`,
    "",
    `Classification:\n${result.status}`,
    "",
    `Action:\n${result.action}`,
  ];
  if (result.stderrExcerpt?.trim()) {
    lines.push("", "Diagnostic (excerpt):", result.stderrExcerpt.trim().slice(0, 400));
  }
  return lines.join("\n");
}
