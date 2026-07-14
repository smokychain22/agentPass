import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type { Finding } from "@/lib/findings/types";
import { prepareRepoWorkspace } from "@/lib/scanner/prepare-workspace";
import { detectPackageManager } from "@/lib/scanner/detect-package-manager";
import { fetchBranchCommitSha } from "@/lib/github/fetch-repo-zip";
import { runBaselineOnlyVerification } from "@/lib/patch-kit/repository-verification";
import { nanoid } from "nanoid";
import {
  classifyBaselineFailure,
  parseBaselineBuildDiagnostic,
  repositoryFileLineUrl,
  type BaselineActionableError,
  type BaselineFailureClassification,
} from "./baseline-diagnostics";

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
  classification?: BaselineFailureClassification;
  firstActionableError?: BaselineActionableError;
}

import { isKnownBaselineInvalidCommit } from "./known-invalid-commits";

export { isKnownBaselineInvalidCommit };

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
    repository?: { owner: string; name: string };
  }
): BaselineReadinessResult {
  const stderrExcerpt = input.stderrExcerpt;
  const parsed = stderrExcerpt ? parseBaselineBuildDiagnostic(stderrExcerpt) : undefined;
  const classification =
    input.classification ??
    classifyBaselineFailure({
      failedCheck: input.failedCheck,
      stderrExcerpt,
      dependencyInstallStatus: input.dependencyInstallStatus,
    });

  const firstActionableError: BaselineActionableError | undefined =
    input.firstActionableError ??
    (parsed || stderrExcerpt
      ? {
          filePath: parsed?.filePath,
          line: parsed?.line,
          column: parsed?.column,
          errorCode: parsed?.errorCode,
          message: parsed?.message ?? stderrExcerpt?.slice(0, 280) ?? "Build failed.",
          baselineCommand: input.failedCheck,
          sourceCommit: input.commitSha,
          causedByCleanup: false,
          fileUrl:
            input.repository && parsed?.filePath
              ? repositoryFileLineUrl({
                  owner: input.repository.owner,
                  name: input.repository.name,
                  commitSha: input.commitSha,
                  filePath: parsed.filePath,
                  line: parsed.line,
                })
              : undefined,
        }
      : undefined);

  return {
    archiveRetrieved: input.archiveRetrieved ?? false,
    touchedFilesParsed: input.touchedFilesParsed ?? false,
    requiredChecksDetected: input.requiredChecksDetected ?? [],
    diagnostics: input.diagnostics ?? [],
    action: "Repair this existing build error, merge the repair, then run a new scan.",
    ...input,
    classification,
    firstActionableError,
  };
}

function parseRepositoryOwnerName(repoUrl: string): { owner: string; name: string } | undefined {
  try {
    const url = new URL(repoUrl);
    const parts = url.pathname.replace(/^\//, "").split("/").filter(Boolean);
    if (parts.length >= 2) return { owner: parts[0]!, name: parts[1]!.replace(/\.git$/, "") };
  } catch {
    return undefined;
  }
  return undefined;
}

export async function runBaselineReadiness(input: {
  repoUrl: string;
  branch?: string;
  commitSha: string;
  touchedPaths?: string[];
  findings?: Finding[];
}): Promise<BaselineReadinessResult> {
  const commitSha = input.commitSha.trim();
  const repository = parseRepositoryOwnerName(input.repoUrl);
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
        repository,
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
    `Failed check:\n${result.failedCheck ?? "baseline verification"}`,
  ];

  const err = result.firstActionableError;
  if (err?.filePath) {
    const loc = err.line ? `${err.filePath}:${err.line}` : err.filePath;
    lines.push("", `First actionable error:\n${loc}`);
  }
  if (err?.message) {
    lines.push("", `Diagnostic:\n${err.message}`);
  } else if (result.stderrExcerpt?.trim()) {
    lines.push("", `Diagnostic:\n${result.stderrExcerpt.trim().slice(0, 400)}`);
  }

  lines.push(
    "",
    `Classification:\n${result.classification ?? result.status}`,
    "",
    "RepoDiet-selected cleanup caused this:\nNo",
    "",
    `Required action:\n${result.action}`
  );

  if (err?.fileUrl) {
    lines.push("", `Source reference:\n${err.fileUrl}`);
  }

  return lines.join("\n");
}
