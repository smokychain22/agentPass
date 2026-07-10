import { A2MCP_VERSION, SERVICE_NAME, TOOL_TIMEOUT_MS, MAX_REPO_ZIP_BYTES, MAX_FILES_ANALYZED } from "./constants";
import { JSON_SCHEMAS } from "./schemas";

const repoInputSchema = {
  type: "object",
  required: ["repoUrl"],
  properties: {
    repoUrl: JSON_SCHEMAS.repoUrl,
    branch: JSON_SCHEMAS.branch,
  },
  additionalProperties: false,
};

export interface ToolManifestEntry {
  name: string;
  endpoint: string;
  method: "POST";
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  exampleRequest: Record<string, unknown>;
  exampleResponse: Record<string, unknown>;
}

export const TOOL_MANIFEST_ENTRIES: ToolManifestEntry[] = [
  {
    name: "scan_repo_bloat",
    endpoint: "/api/tools/scan_repo_bloat",
    method: "POST",
    description:
      "Scan a public GitHub repo for structure, bloat signals, analyzer status, and cleanup risk buckets.",
    inputSchema: {
      ...repoInputSchema,
      properties: {
        ...repoInputSchema.properties,
        mode: { type: "string", enum: ["quick", "full"], default: "quick" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        tool: { type: "string" },
        version: { type: "string" },
        repo: { type: "object" },
        scan: { type: "object" },
        findings: { type: "object" },
        analyzerStatus: { type: "object" },
        policy: { type: "object" },
        warnings: { type: "array", items: { type: "string" } },
      },
    },
    exampleRequest: {
      repoUrl: "https://github.com/Ibrahimmovic/Circle-Arc-Net",
      branch: "main",
      mode: "quick",
    },
    exampleResponse: {
      ok: true,
      tool: "scan_repo_bloat",
      version: A2MCP_VERSION,
      repo: { owner: "Ibrahimmovic", name: "Circle-Arc-Net", branch: "main" },
      warnings: [],
    },
  },
  {
    name: "detect_duplicate_code",
    endpoint: "/api/tools/detect_duplicate_code",
    method: "POST",
    description: "Detect duplicate code clusters in a public GitHub repository.",
    inputSchema: {
      ...repoInputSchema,
      properties: {
        ...repoInputSchema.properties,
        limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        tool: { type: "string" },
        duplicates: { type: "array" },
        summary: { type: "object" },
      },
    },
    exampleRequest: {
      repoUrl: "https://github.com/vercel/next-learn",
      branch: "main",
      limit: 25,
    },
    exampleResponse: {
      ok: true,
      tool: "detect_duplicate_code",
      version: A2MCP_VERSION,
      summary: { duplicateClusters: 0, source: "jscpd" },
      duplicates: [],
      warnings: [],
    },
  },
  {
    name: "find_dead_files",
    endpoint: "/api/tools/find_dead_files",
    method: "POST",
    description: "Find unused files and orphan patterns in a public GitHub repository.",
    inputSchema: {
      ...repoInputSchema,
      properties: {
        ...repoInputSchema.properties,
        includeOrphans: { type: "boolean", default: true },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        tool: { type: "string" },
        unusedFiles: { type: "array" },
        orphans: { type: "array" },
        summary: { type: "object" },
        note: { type: "string" },
      },
    },
    exampleRequest: {
      repoUrl: "https://github.com/Ibrahimmovic/Circle-Arc-Net",
      branch: "main",
      includeOrphans: true,
    },
    exampleResponse: {
      ok: true,
      tool: "find_dead_files",
      version: A2MCP_VERSION,
      summary: { unusedFiles: 0, orphanPatterns: 0, safeCandidates: 0, reviewFirst: 0 },
      unusedFiles: [],
      orphans: [],
      note: "Review First items are not automatic delete candidates.",
      warnings: [],
    },
  },
  {
    name: "find_unused_dependencies",
    endpoint: "/api/tools/find_unused_dependencies",
    method: "POST",
    description: "Find potentially unused npm dependencies in a public GitHub repository.",
    inputSchema: repoInputSchema,
    outputSchema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        tool: { type: "string" },
        dependencies: { type: "array" },
        summary: { type: "object" },
        warning: { type: "string" },
      },
    },
    exampleRequest: {
      repoUrl: "https://github.com/Ibrahimmovic/Circle-Arc-Net",
      branch: "main",
    },
    exampleResponse: {
      ok: true,
      tool: "find_unused_dependencies",
      version: A2MCP_VERSION,
      summary: {
        unusedDependencies: 0,
        source: "fallback",
        confidencePolicy: "review_before_removing",
      },
      dependencies: [],
      warnings: [],
    },
  },
  {
    name: "generate_cleanup_patch",
    endpoint: "/api/tools/generate_cleanup_patch",
    method: "POST",
    description:
      "Generate conservative Patch Kit artifacts including cleanup.patch, reports, and optional ZIP bundle.",
    inputSchema: {
      ...repoInputSchema,
      properties: {
        ...repoInputSchema.properties,
        includeZip: { type: "boolean", default: false },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        tool: { type: "string" },
        summary: { type: "object" },
        artifacts: { type: "object" },
        policy: { type: "object" },
      },
    },
    exampleRequest: {
      repoUrl: "https://github.com/Ibrahimmovic/Circle-Arc-Net",
      branch: "main",
      includeZip: false,
    },
    exampleResponse: {
      ok: true,
      tool: "generate_cleanup_patch",
      version: A2MCP_VERSION,
      summary: { safeCandidates: 0, reviewFirst: 0, doNotTouch: 0, bundleFiles: 7 },
      policy: { autoDeletes: false, safeCandidatesOnly: true },
      warnings: [],
    },
  },
  {
    name: "generate_regression_checklist",
    endpoint: "/api/tools/generate_regression_checklist",
    method: "POST",
    description: "Generate a regression checklist markdown and structured route/API checks.",
    inputSchema: repoInputSchema,
    outputSchema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        tool: { type: "string" },
        checklistMd: { type: "string" },
        checks: { type: "object" },
      },
    },
    exampleRequest: {
      repoUrl: "https://github.com/Ibrahimmovic/Circle-Arc-Net",
      branch: "main",
    },
    exampleResponse: {
      ok: true,
      tool: "generate_regression_checklist",
      version: A2MCP_VERSION,
      checklistMd: "# RepoDiet Regression Checklist",
      checks: { build: ["npm install"], routes: ["/"], apiRoutes: ["/api/scans/run"] },
      warnings: [],
    },
  },
  {
    name: "create_cleanup_pr",
    endpoint: "/api/tools/create_cleanup_pr",
    method: "POST",
    description:
      "Create a review-ready GitHub cleanup pull request via connected GitHub App installation. Safe deletions and RepoDiet artifacts only.",
    inputSchema: {
      type: "object",
      required: ["repoUrl"],
      properties: {
        repoUrl: JSON_SCHEMAS.repoUrl,
        branch: JSON_SCHEMAS.branch,
        mode: {
          type: "string",
          enum: ["safe_only", "report_only"],
          default: "safe_only",
        },
        findings: {
          type: "object",
          description: "Optional precomputed findings payload to reuse.",
        },
        patchKit: {
          type: "object",
          description: "Optional precomputed patch kit payload to reuse.",
        },
        demo: {
          type: "boolean",
          default: false,
          description: "Demo repo only — uses server demo token, not for normal users.",
        },
        githubToken: {
          type: "string",
          description:
            "Advanced fallback only. Primary auth is GitHub App installation via browser session.",
        },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        tool: { type: "string" },
        version: { type: "string" },
        repo: { type: "object" },
        pullRequest: { type: "object" },
        actionSummary: { type: "object" },
        policy: { type: "object" },
        warnings: { type: "array", items: { type: "string" } },
      },
    },
    exampleRequest: {
      repoUrl: "https://github.com/user/repo",
      branch: "main",
      mode: "safe_only",
    },
    exampleResponse: {
      ok: true,
      tool: "create_cleanup_pr",
      version: A2MCP_VERSION,
      repo: {
        owner: "user",
        name: "repo",
        baseBranch: "main",
        cleanupBranch: "repodiet/cleanup-20260710-abc123",
      },
      pullRequest: {
        url: "https://github.com/user/repo/pull/1",
        number: 1,
        title: "RepoDiet: review-first cleanup bundle",
      },
      policy: { mainBranchMutated: false, requiresHumanMerge: true },
      warnings: [],
    },
  },
];

export function buildServiceManifest() {
  return {
    name: SERVICE_NAME,
    description:
      "AI-code-bloat cleanup tools for JavaScript and TypeScript repositories.",
    version: A2MCP_VERSION,
    category: "Software Utility",
    runtime: "nodejs",
    limits: {
      maxRepoZipMb: MAX_REPO_ZIP_BYTES / (1024 * 1024),
      maxFilesAnalyzed: MAX_FILES_ANALYZED,
      timeoutSeconds: TOOL_TIMEOUT_MS / 1000,
      publicReposOnly: true,
      repoMutation: false,
      autoDelete: false,
    },
    tools: TOOL_MANIFEST_ENTRIES.map(
      ({ name, endpoint, method, description, inputSchema, outputSchema }) => ({
        name,
        endpoint,
        method,
        description,
        inputSchema,
        outputSchema,
      })
    ),
  };
}

export function buildToolsIndex() {
  return {
    ok: true,
    service: SERVICE_NAME,
    version: A2MCP_VERSION,
    tools: TOOL_MANIFEST_ENTRIES.map((t) => ({
      name: t.name,
      endpoint: t.endpoint,
      method: t.method,
      description: t.description,
    })),
  };
}

export function buildHealthResponse() {
  return {
    ok: true,
    service: SERVICE_NAME,
    version: A2MCP_VERSION,
    runtime: "nodejs",
    tools: {
      scan_repo_bloat: "available",
      detect_duplicate_code: "available",
      find_dead_files: "available",
      find_unused_dependencies: "available",
      generate_cleanup_patch: "available",
      generate_regression_checklist: "available",
      create_cleanup_pr: "available",
    },
    analyzers: {
      knip: "native_or_fallback",
      jscpd: "native_or_fallback",
      madge: "native_or_fallback",
      heuristics: "available",
    },
  };
}
