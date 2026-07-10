import { A2MCP_VERSION, SERVICE_NAME, TOOL_TIMEOUT_MS, MAX_REPO_ZIP_BYTES, MAX_FILES_ANALYZED, OPERATOR_TOOL_TIMEOUT_MS } from "./constants";
import { JSON_SCHEMAS } from "./schemas";
import { getServerBaseUrl } from "@/lib/docs/base-url";
import { PHASE3_TOOL_ENTRIES } from "./phase3-manifest";

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
  method: "POST" | "GET";
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  exampleRequest: Record<string, unknown>;
  exampleResponse: Record<string, unknown>;
}

export const TOOL_MANIFEST_ENTRIES: ToolManifestEntry[] = [
  ...PHASE3_TOOL_ENTRIES,
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
];

export function buildServiceManifest() {
  const baseUrl = getServerBaseUrl();
  return {
    name: SERVICE_NAME,
    description:
      "AI-code-bloat cleanup tools for JavaScript and TypeScript repositories. Phase 3 agent tools execute the same engine as the web application.",
    version: A2MCP_VERSION,
    category: "Software Utility",
    runtime: "nodejs",
    productionUrl: baseUrl,
    operator: {
      id: "repodiet-operator",
      publicKeyEnv: "REPODIET_OPERATOR_PUBLIC_KEY",
      signingAvailable: Boolean(process.env.REPODIET_OPERATOR_PRIVATE_KEY),
    },
    capabilities: [
      "repository_scan",
      "findings_analysis",
      "safe_fix_selection",
      "free_proof_cleanup",
      "patch_kit_generation",
      "cleanup_verification",
      "cleanup_pr_creation",
    ],
    agentFlow: [
      "scan_repository",
      "analyze_repository",
      "list_safe_fixes",
      "run_free_safe_fix",
      "get_task_status",
    ],
    pricing: {
      freeProof: { operation: "run_free_safe_fix", limitPerRepo: 1, priceUsdt: 0 },
      quickCleanup: { operation: "run_quick_cleanup", priceUsdt: 0.25 },
      verifiedCleanupPr: { operation: "create_cleanup_pr", priceUsdtMin: 1, priceUsdtMax: 3 },
      repoGuard: { operation: "activate_repo_guard", priceUsdtMonthlyMin: 3, priceUsdtMonthlyMax: 5, available: false },
    },
    freeLimits: {
      freeProofFixes: 1,
      publicReposOnly: true,
    },
    timeouts: {
      defaultToolSeconds: TOOL_TIMEOUT_MS / 1000,
      operatorToolSeconds: OPERATOR_TOOL_TIMEOUT_MS / 1000,
      freeProofSeconds: 300,
    },
    payment: {
      protocol: "x402",
      enforcedOnTools: ["run_quick_cleanup", "create_cleanup_pr"],
      betaOpenAccess: true,
    },
    healthEndpoint: `${baseUrl}/api/tools/health`,
    supportUrl: `${baseUrl}/docs`,
    privacy: {
      publicReposOnly: true,
      envFilesNeverRead: true,
      workspaceRetention: "Ephemeral — isolated workspaces deleted after tool execution.",
      githubMutation: "Never on scan/analyze/free proof. PR tools create branches only.",
    },
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
  const phase3Tools = Object.fromEntries(
    PHASE3_TOOL_ENTRIES.map((t) => [t.name, "available"])
  );
  const legacyTools = {
    scan_repo_bloat: "available",
    detect_duplicate_code: "available",
    find_dead_files: "available",
    find_unused_dependencies: "available",
    generate_cleanup_patch: "available",
    generate_regression_checklist: "available",
    find_orphan_patterns: "available",
  };

  return {
    ok: true,
    service: SERVICE_NAME,
    version: A2MCP_VERSION,
    runtime: "nodejs",
    engine: "shared_execution_engine",
    tools: { ...phase3Tools, ...legacyTools },
    analyzers: {
      knip: { status: "native_or_fallback", honestLabeling: true },
      jscpd: { status: "native_or_fallback", honestLabeling: true },
      madge: { status: "native_or_fallback", honestLabeling: true },
      heuristics: { status: "available", honestLabeling: true },
    },
  };
}
