import { A2MCP_VERSION } from "./constants";
import { JSON_SCHEMAS } from "./schemas";
import type { ToolManifestEntry } from "./tool-manifest";

const repoInput = {
  type: "object",
  required: ["repoUrl"],
  properties: {
    repoUrl: JSON_SCHEMAS.repoUrl,
    branch: JSON_SCHEMAS.branch,
  },
  additionalProperties: false,
};

const repoRefInput = {
  type: "object",
  properties: {
    repoUrl: JSON_SCHEMAS.repoUrl,
    branch: JSON_SCHEMAS.branch,
    scanId: { type: "string", description: "Prior scan identifier from scan_repository." },
    taskId: { type: "string", description: "Prior task identifier." },
  },
  additionalProperties: false,
};

const actionOutputSchema = {
  type: "object",
  properties: {
    success: { type: "boolean" },
    taskId: { type: "string" },
    tool: { type: "string" },
    version: { type: "string" },
    repository: { type: "object" },
    status: { type: "string", enum: ["queued", "running", "completed", "failed"] },
    result: { type: "object" },
    analyzers: { type: "object" },
    limitations: { type: "array", items: { type: "string" } },
    receipt: { type: "object" },
  },
};

export const PHASE3_TOOL_ENTRIES: ToolManifestEntry[] = [
  {
    name: "scan_repository",
    endpoint: "/api/tools/scan_repository",
    method: "POST",
    description: "Scan a public repository and persist findings via the shared execution engine.",
    inputSchema: repoInput,
    outputSchema: actionOutputSchema,
    exampleRequest: { repoUrl: "https://github.com/repodiet/demo-slop-app", branch: "main" },
    exampleResponse: {
      success: true,
      taskId: "task_abc123",
      status: "completed",
      result: { scanId: "scan_xyz" },
    },
  },
  {
    name: "analyze_repository",
    endpoint: "/api/tools/analyze_repository",
    method: "POST",
    description: "Analyze repository findings (by scanId, taskId, or repoUrl). Paid A2MCP tool — 0.03 USDT via x402 when REPODIET_OKX_A2MCP_PAID=1.",
    inputSchema: {
      ...repoRefInput,
      properties: {
        ...repoRefInput.properties,
        commitSha: { type: "string", description: "Exact commit SHA for payment binding." },
        quoteId: { type: "string", description: "Funded x402 quote from POST /api/tasks/pay." },
        idempotencyKey: { type: "string" },
      },
    },
    outputSchema: actionOutputSchema,
    exampleRequest: { scanId: "scan_xyz" },
    exampleResponse: { success: true, taskId: "task_analyze", status: "completed", result: {} },
  },
  {
    name: "get_findings",
    endpoint: "/api/tools/get_findings",
    method: "POST",
    description: "Return the full findings payload for a completed scan.",
    inputSchema: repoRefInput,
    outputSchema: actionOutputSchema,
    exampleRequest: { scanId: "scan_xyz" },
    exampleResponse: { success: true, taskId: "task_findings", status: "completed", result: {} },
  },
  {
    name: "list_safe_fixes",
    endpoint: "/api/tools/list_safe_fixes",
    method: "POST",
    description: "List Phase 1 eligible safe fixes for automatic cleanup.",
    inputSchema: repoRefInput,
    outputSchema: actionOutputSchema,
    exampleRequest: { scanId: "scan_xyz" },
    exampleResponse: { success: true, taskId: "task_safe", status: "completed", result: { count: 1 } },
  },
  {
    name: "verify_patch",
    endpoint: "/api/tools/verify_patch",
    method: "POST",
    description: "Baseline comparison and verification for a cleanup run patch.",
    inputSchema: {
      ...repoRefInput,
      properties: {
        ...repoRefInput.properties,
        cleanupRunId: { type: "string" },
        patchId: { type: "string" },
        quoteId: { type: "string" },
      },
    },
    outputSchema: actionOutputSchema,
    exampleRequest: { cleanupRunId: "cleanup_abc", scanId: "scan_xyz" },
    exampleResponse: { success: true, taskId: "task_verify", status: "completed", result: {} },
  },
  {
    name: "repository_health_delta",
    endpoint: "/api/tools/repository_health_delta",
    method: "POST",
    description: "New, resolved and recurring debt between two repository snapshots.",
    inputSchema: {
      type: "object",
      properties: {
        ...repoRefInput.properties,
        baseScanId: { type: "string" },
        headScanId: { type: "string" },
        baseCommitSha: { type: "string" },
        headCommitSha: { type: "string" },
        quoteId: { type: "string" },
      },
    },
    outputSchema: actionOutputSchema,
    exampleRequest: { baseScanId: "scan_old", scanId: "scan_new" },
    exampleResponse: { success: true, taskId: "task_delta", status: "completed", result: {} },
  },
  {
    name: "get_repository_health",
    endpoint: "/api/tools/get_repository_health",
    method: "POST",
    description: "Repository health summary with honest analyzer status fields.",
    inputSchema: repoRefInput,
    outputSchema: actionOutputSchema,
    exampleRequest: { scanId: "scan_xyz" },
    exampleResponse: { success: true, taskId: "task_health", status: "completed", result: {} },
  },
  {
    name: "get_task_status",
    endpoint: "/api/tools/tasks/{taskId}",
    method: "GET",
    description: "Poll task status and result by taskId.",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: { taskId: { type: "string" } },
    },
    outputSchema: actionOutputSchema,
    exampleRequest: { taskId: "task_abc123" },
    exampleResponse: { success: true, taskId: "task_abc123", status: "completed", result: {} },
  },
  {
    name: "run_free_safe_fix",
    endpoint: "/api/tools/run_free_safe_fix",
    method: "POST",
    description: "Execute one verified safe fix in an isolated workspace (free proof).",
    inputSchema: {
      ...repoRefInput,
      properties: {
        ...repoRefInput.properties,
        findingIds: { type: "array", items: { type: "string" } },
      },
    },
    outputSchema: actionOutputSchema,
    exampleRequest: { scanId: "scan_xyz" },
    exampleResponse: { success: true, taskId: "task_fix", status: "completed", result: { finalDecision: "retained" } },
  },
  {
    name: "run_quick_cleanup",
    endpoint: "/api/tools/run_quick_cleanup",
    method: "POST",
    description: "Generate Patch Kit cleanup bundle for selected findings (paid tier).",
    inputSchema: {
      ...repoRefInput,
      properties: {
        ...repoRefInput.properties,
        findingIds: { type: "array", items: { type: "string" } },
        quoteId: { type: "string", description: "Optional task quote for x402 settlement." },
      },
    },
    outputSchema: actionOutputSchema,
    exampleRequest: { scanId: "scan_xyz" },
    exampleResponse: { success: true, taskId: "task_quick", status: "completed", result: {} },
  },
  {
    name: "run_cleanup",
    endpoint: "/api/tools/run_cleanup",
    method: "POST",
    description: "Unified cleanup runner — operation free_proof or quick_cleanup.",
    inputSchema: {
      ...repoRefInput,
      properties: {
        ...repoRefInput.properties,
        operation: { type: "string", enum: ["free_proof", "quick_cleanup"] },
        findingIds: { type: "array", items: { type: "string" } },
        quoteId: { type: "string" },
      },
    },
    outputSchema: actionOutputSchema,
    exampleRequest: { scanId: "scan_xyz", operation: "free_proof" },
    exampleResponse: { success: true, taskId: "task_cleanup", status: "completed", result: {} },
  },
  {
    name: "verify_cleanup",
    endpoint: "/api/tools/verify_cleanup",
    method: "POST",
    description: "Verify a cleanup patch or cleanup run in an isolated workspace.",
    inputSchema: {
      type: "object",
      properties: {
        patchId: { type: "string" },
        cleanupRunId: { type: "string" },
        scanId: { type: "string" },
      },
    },
    outputSchema: actionOutputSchema,
    exampleRequest: { patchId: "patchkit_abc" },
    exampleResponse: { success: true, taskId: "task_verify", status: "completed", result: {} },
  },
  {
    name: "create_cleanup_pr",
    endpoint: "/api/tools/create_cleanup_pr",
    method: "POST",
    description: "Create a review-ready GitHub cleanup pull request.",
    inputSchema: {
      type: "object",
      required: ["repoUrl"],
      properties: {
        repoUrl: JSON_SCHEMAS.repoUrl,
        branch: JSON_SCHEMAS.branch,
        mode: { type: "string", enum: ["safe_only", "report_only"] },
        findings: { type: "object" },
        patchKit: { type: "object" },
        demo: { type: "boolean" },
        githubToken: { type: "string" },
      },
    },
    outputSchema: actionOutputSchema,
    exampleRequest: { repoUrl: "https://github.com/user/repo", mode: "safe_only" },
    exampleResponse: { success: true, taskId: "task_pr", status: "completed", result: {} },
  },
  {
    name: "configure_repository_policy",
    endpoint: "/api/tools/configure_repository_policy",
    method: "POST",
    description: "Store protected path policy for a repository.",
    inputSchema: {
      ...repoInput,
      properties: {
        ...repoInput.properties,
        protectedPaths: { type: "array", items: { type: "string" } },
        protectedGlobs: { type: "array", items: { type: "string" } },
      },
    },
    outputSchema: actionOutputSchema,
    exampleRequest: { repoUrl: "https://github.com/user/repo", protectedGlobs: ["app/**/route.ts"] },
    exampleResponse: { success: true, taskId: "task_policy", status: "completed", result: {} },
  },
  {
    name: "activate_repo_guard",
    endpoint: "/api/tools/activate_repo_guard",
    method: "POST",
    description: "Activate Repo Guard monitoring (returns honest not-available until Phase 4).",
    inputSchema: repoInput,
    outputSchema: actionOutputSchema,
    exampleRequest: { repoUrl: "https://github.com/user/repo" },
    exampleResponse: { success: false, taskId: "task_guard", status: "failed", limitations: ["Repo Guard not implemented"] },
  },
];

export const PHASE3_AGENT_FLOW = [
  "scan_repository",
  "analyze_repository",
  "list_safe_fixes",
  "run_free_safe_fix",
  "get_task_status",
] as const;
