export const ERROR_CODES = [
  "INVALID_INPUT",
  "INVALID_GITHUB_URL",
  "MISSING_GITHUB_TOKEN",
  "GITHUB_APP_NOT_CONFIGURED",
  "GITHUB_APP_NOT_CONNECTED",
  "DEMO_REPO_ONLY",
  "REPO_NOT_FOUND",
  "BRANCH_NOT_FOUND",
  "NO_SAFE_CANDIDATES",
  "GITHUB_PERMISSION_DENIED",
  "PR_CREATION_FAILED",
  "REPO_TOO_LARGE",
  "SCAN_TIMEOUT",
  "ANALYZER_FAILED",
  "PATCH_GENERATION_FAILED",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface RepoToolInput {
  repoUrl: string;
  branch?: string;
}

export interface ScanRepoBloatInput extends RepoToolInput {
  mode?: "quick" | "full";
}

export interface DetectDuplicateCodeInput extends RepoToolInput {
  limit?: number;
}

export interface FindDeadFilesInput extends RepoToolInput {
  includeOrphans?: boolean;
}

export interface GenerateCleanupPatchInput extends RepoToolInput {
  includeZip?: boolean;
}

export interface CreateCleanupPrInput extends RepoToolInput {
  githubToken?: string;
  mode?: "safe_only" | "report_only";
  findings?: Record<string, unknown>;
  patchKit?: Record<string, unknown>;
  demo?: boolean;
}

function readRepoBody(body: Record<string, unknown>): RepoToolInput {
  if (typeof body.repoUrl !== "string" || !body.repoUrl.trim()) {
    throw new Error("repoUrl is required.");
  }
  return {
    repoUrl: body.repoUrl.trim(),
    branch: typeof body.branch === "string" ? body.branch.trim() : undefined,
  };
}

export const ToolInputSchemas = {
  scanRepoBloat(body: unknown): ScanRepoBloatInput {
    if (!body || typeof body !== "object") throw new Error("Invalid request body.");
    const record = body as Record<string, unknown>;
    const base = readRepoBody(record);
    const mode = record.mode === "quick" || record.mode === "full" ? record.mode : "quick";
    return { ...base, mode };
  },

  repoOnly(body: unknown): RepoToolInput {
    if (!body || typeof body !== "object") throw new Error("Invalid request body.");
    return readRepoBody(body as Record<string, unknown>);
  },

  detectDuplicateCode(body: unknown): DetectDuplicateCodeInput {
    if (!body || typeof body !== "object") throw new Error("Invalid request body.");
    const record = body as Record<string, unknown>;
    const base = readRepoBody(record);
    const limit =
      typeof record.limit === "number" && record.limit > 0
        ? Math.min(Math.floor(record.limit), 100)
        : 25;
    return { ...base, limit };
  },

  findDeadFiles(body: unknown): FindDeadFilesInput {
    if (!body || typeof body !== "object") throw new Error("Invalid request body.");
    const record = body as Record<string, unknown>;
    const base = readRepoBody(record);
    return {
      ...base,
      includeOrphans: record.includeOrphans !== false,
    };
  },

  generateCleanupPatch(body: unknown): GenerateCleanupPatchInput {
    if (!body || typeof body !== "object") throw new Error("Invalid request body.");
    const record = body as Record<string, unknown>;
    const base = readRepoBody(record);
    return {
      ...base,
      includeZip: record.includeZip === true,
    };
  },

  createCleanupPr(body: unknown): CreateCleanupPrInput {
    if (!body || typeof body !== "object") throw new Error("Invalid request body.");
    const record = body as Record<string, unknown>;
    const base = readRepoBody(record);
    const mode =
      record.mode === "report_only" || record.mode === "safe_only"
        ? record.mode
        : "safe_only";

    return {
      ...base,
      githubToken:
        typeof record.githubToken === "string" ? record.githubToken.trim() : undefined,
      mode,
      findings:
        record.findings && typeof record.findings === "object"
          ? (record.findings as Record<string, unknown>)
          : undefined,
      patchKit:
        record.patchKit && typeof record.patchKit === "object"
          ? (record.patchKit as Record<string, unknown>)
          : undefined,
      demo: record.demo === true,
    };
  },
};

export const JSON_SCHEMAS = {
  repoUrl: {
    type: "string",
    description: "Public GitHub repository URL (https://github.com/owner/repo).",
  },
  branch: {
    type: "string",
    description: "Optional branch name. Defaults to repository default branch.",
  },
};
