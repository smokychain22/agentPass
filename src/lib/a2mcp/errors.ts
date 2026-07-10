import type { ErrorCode } from "./schemas";

export class ToolExecutionError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, status = 422) {
    super(message);
    this.name = "ToolExecutionError";
    this.code = code;
    this.status = status;
  }
}

export function mapErrorToToolError(err: unknown, tool: string): ToolExecutionError {
  if (err instanceof ToolExecutionError) return err;

  const message = err instanceof Error ? err.message : "Unexpected tool failure.";

  if (err instanceof Error && err.name === "AbortError") {
    return new ToolExecutionError(
      "SCAN_TIMEOUT",
      `Tool "${tool}" timed out after ${60} seconds.`,
      504
    );
  }

  const lower = message.toLowerCase();

  if (lower.includes("invalid github url") || lower.includes("invalid github")) {
    return new ToolExecutionError("INVALID_GITHUB_URL", message, 400);
  }
  if (lower.includes("invalid request") || lower.includes("invalid input") || lower.includes("required")) {
    return new ToolExecutionError("INVALID_INPUT", message, 400);
  }
  if (lower.includes("branch") && (lower.includes("fetch") || lower.includes("not found") || lower.includes("exists"))) {
    return new ToolExecutionError(
      "BRANCH_NOT_FOUND",
      "Could not fetch this branch. Check if the branch exists or leave branch empty to use the default branch.",
      404
    );
  }
  if (
    lower.includes("could not fetch repository") ||
    lower.includes("private") ||
    lower.includes("forbidden") ||
    lower.includes("repo not found")
  ) {
    return new ToolExecutionError(
      "REPO_NOT_FOUND",
      "Could not fetch repository. Check if the repo is public and the branch exists.",
      404
    );
  }
  if (lower.includes("exceeds") && lower.includes("25mb")) {
    return new ToolExecutionError(
      "REPO_TOO_LARGE",
      "Repository ZIP exceeds the 25MB analysis limit.",
      413
    );
  }
  if (lower.includes("file limit") || lower.includes("too many files")) {
    return new ToolExecutionError(
      "REPO_TOO_LARGE",
      `Repository exceeds the ${5000} file analysis limit.`,
      413
    );
  }
  if (lower.includes("patch kit") || lower.includes("patch generation")) {
    return new ToolExecutionError("PATCH_GENERATION_FAILED", message, 422);
  }
  if (lower.includes("github token") && lower.includes("required")) {
    return new ToolExecutionError("MISSING_GITHUB_TOKEN", message, 401);
  }
  if (lower.includes("demo mode only") || lower.includes("demo repository")) {
    return new ToolExecutionError("DEMO_REPO_ONLY", message, 403);
  }
  if (lower.includes("no safe cleanup pr") || lower.includes("no safe candidates")) {
    return new ToolExecutionError("NO_SAFE_CANDIDATES", message, 422);
  }
  if (lower.includes("permission") || lower.includes("forbidden") && lower.includes("github")) {
    return new ToolExecutionError("GITHUB_PERMISSION_DENIED", message, 403);
  }
  if (lower.includes("pull request") || lower.includes("failed to open github")) {
    return new ToolExecutionError("PR_CREATION_FAILED", message, 502);
  }
  if (lower.includes("analyzer") || lower.includes("knip") || lower.includes("jscpd") || lower.includes("madge")) {
    return new ToolExecutionError("ANALYZER_FAILED", message, 422);
  }

  return new ToolExecutionError("INTERNAL_ERROR", message, 500);
}
