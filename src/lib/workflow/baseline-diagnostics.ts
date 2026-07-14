export type BaselineFailureClassification =
  | "baseline_source_invalid"
  | "baseline_dependency_failure"
  | "baseline_environment_blocked"
  | "baseline_command_missing"
  | "baseline_infrastructure_failed"
  | "transform_introduced_diagnostic"
  | "verification_regression"
  | "pre_existing_repository_error";

export interface BaselineActionableError {
  filePath?: string;
  line?: number;
  column?: number;
  errorCode?: string;
  message: string;
  baselineCommand?: string;
  sourceCommit?: string;
  causedByCleanup: boolean;
  fileUrl?: string;
}

const TS_LOCATION_RE =
  /\.\/(src\/[^\s:]+):(\d+):(\d+)\s*\n\s*Type error:\s*([\s\S]+?)(?:\n|$)/;

const TS_LOCATION_ALT_RE =
  /(src\/[^\s:]+):(\d+):(\d+)\s*\n\s*Type error:\s*([\s\S]+?)(?:\n|$)/;

const TS_CODE_IN_MESSAGE_RE = /\bTS\d{4,5}\b/;

export function parseBaselineBuildDiagnostic(stderr: string): BaselineActionableError | undefined {
  const text = stderr.trim();
  if (!text) return undefined;

  const match = TS_LOCATION_RE.exec(text) ?? TS_LOCATION_ALT_RE.exec(text);
  if (match) {
    const filePath = match[1]!.replace(/^\.\//, "");
    const message = match[4]!.trim();
    const errorCode = TS_CODE_IN_MESSAGE_RE.exec(message)?.[0];
    return {
      filePath,
      line: Number(match[2]),
      column: Number(match[3]),
      errorCode,
      message,
      causedByCleanup: false,
    };
  }

  const firstLine = text.split("\n").find((line) => line.trim().length > 0)?.trim();
  if (!firstLine) return undefined;
  return {
    message: firstLine.slice(0, 280),
    causedByCleanup: false,
  };
}

export function classifyBaselineFailure(input: {
  failedCheck?: string;
  stderrExcerpt?: string;
  dependencyInstallStatus?: "passed" | "failed" | "skipped";
  causedByTransform?: boolean;
}): BaselineFailureClassification {
  if (input.causedByTransform) return "transform_introduced_diagnostic";
  const stderr = input.stderrExcerpt ?? "";
  const check = input.failedCheck ?? "";

  if (check === "repository archive" || input.dependencyInstallStatus === "failed") {
    return /ENOTFOUND|ETIMEDOUT|network|rate limit/i.test(stderr)
      ? "baseline_infrastructure_failed"
      : "baseline_dependency_failure";
  }

  if (/env|environment variable|NEXT_PUBLIC|missing required/i.test(stderr)) {
    return "baseline_environment_blocked";
  }

  if (/command not found|Missing script|npm ERR! missing script/i.test(stderr)) {
    return "baseline_command_missing";
  }

  if (/Type error:|Cannot find module|SyntaxError|Failed to compile/i.test(stderr)) {
    return "pre_existing_repository_error";
  }

  if (check.includes("build") || check.includes("typecheck")) {
    return "baseline_source_invalid";
  }

  return "baseline_source_invalid";
}

export function repositoryFileLineUrl(input: {
  owner: string;
  name: string;
  commitSha: string;
  filePath?: string;
  line?: number;
}): string | undefined {
  if (!input.filePath) return undefined;
  const base = `https://github.com/${input.owner}/${input.name}/blob/${input.commitSha}/${input.filePath}`;
  return input.line ? `${base}#L${input.line}` : base;
}
