import { getServerBaseUrl } from "@/lib/docs/base-url";
import { A2MCP_VERSION } from "@/lib/a2mcp/constants";
import { OKX_A2A_SERVICE } from "@/lib/marketing/content";
import type { A2ATaskType } from "./types";

export function buildAgentCard() {
  const baseUrl = getServerBaseUrl();
  const publicKey = process.env.REPODIET_OPERATOR_PUBLIC_KEY?.trim() ?? null;

  return {
    name: "RepoDiet",
    version: A2MCP_VERSION,
    description: OKX_A2A_SERVICE.description,
    url: baseUrl,
    identity: {
      operator: "repodiet-operator",
      service: OKX_A2A_SERVICE.name,
      category: "repository_maintenance",
    },
    operator: {
      id: "repodiet-operator",
      publicKey,
      signingAlgorithm: publicKey ? "RSA-SHA256" : null,
    },
    supportedTaskTypes: [
      {
        type: "repository.analysis",
        description: "Scan and analyze a public repository for cleanup risk.",
        paymentRequired: false,
      },
      {
        type: "repository.safe_cleanup",
        description: "Execute one verified safe fix in an isolated workspace (free proof).",
        paymentRequired: false,
      },
      {
        type: "repository.verified_cleanup",
        description: "Generate and verify a Patch Kit cleanup bundle.",
        paymentRequired: true,
        priceHint: "0.25 USDT",
      },
      {
        type: "repository.cleanup_pr",
        description: "Verified cleanup with human approval before GitHub PR creation.",
        paymentRequired: true,
        priceHint: "1–3 USDT",
        requiresApproval: true,
      },
      {
        type: "repository.guard_activation",
        description: "Activate continuous repository monitoring with delta scans and policy enforcement.",
        paymentRequired: true,
        priceHint: "3–5 USDT/month",
        available: true,
      },
    ] satisfies Array<{
      type: A2ATaskType;
      description: string;
      paymentRequired: boolean;
      priceHint?: string;
      requiresApproval?: boolean;
      available?: boolean;
    }>,
    authentication: {
      publicScan: "none",
      githubMutation: "github_app_installation_or_token",
      paidTasks: "bound_quote_via_x402",
    },
    payment: {
      protocol: "x402",
      quoteEndpoint: `${baseUrl}/api/tasks/quote`,
      payEndpoint: `${baseUrl}/api/tasks/pay`,
      enforcement: process.env.REQUIRE_REAL_X402 === "1" ? "strict" : "test_or_demo",
      binding: [
        "quoteId",
        "operation",
        "repository",
        "branch",
        "commitSha",
        "findingIds",
        "requestHash",
        "nonce",
      ],
    },
    endpoints: {
      submitTask: `${baseUrl}/api/a2a/tasks`,
      proposeMaintenanceContract: `${baseUrl}/api/green-pr/contracts`,
      acceptMaintenanceContract: `${baseUrl}/api/green-pr/contracts/{contractId}/accept`,
      verifyAttestation: `${baseUrl}/api/attestations/verify`,
      taskStatus: `${baseUrl}/api/a2a/tasks/{taskId}`,
      approveTask: `${baseUrl}/api/a2a/tasks/{taskId}/approve`,
      fundTask: `${baseUrl}/api/a2a/tasks/{taskId}/fund`,
      cancelTask: `${baseUrl}/api/a2a/tasks/{taskId}/cancel`,
      guardRun: `${baseUrl}/api/guard/run`,
      guardStatus: `${baseUrl}/api/guard/{repository}`,
      githubWebhook: `${baseUrl}/api/github/webhook`,
      manifest: `${baseUrl}/api/tools/manifest`,
      health: `${baseUrl}/api/tools/health`,
      maintenanceContractSchema: `${baseUrl}/schemas/repodiet.contract.v1.schema.json`,
    },
    inputFormats: {
      submitTask: {
        type: "object",
        required: ["type", "repoUrl"],
        properties: {
          type: { type: "string" },
          repoUrl: { type: "string" },
          branch: { type: "string" },
          findingIds: { type: "array", items: { type: "string" } },
          quoteId: { type: "string" },
          paymentReference: { type: "string" },
          callbackUrl: { type: "string", format: "uri" },
          githubToken: { type: "string" },
          demo: { type: "boolean" },
          contractId: { type: "string" },
          contractDigest: { type: "string" },
        },
      },
      approveTask: {
        type: "object",
        required: ["approved"],
        properties: { approved: { type: "boolean" } },
      },
    },
    outputFormats: {
      taskStatus: {
        taskId: "string",
        status: "string",
        repository: "object",
        findings: "object",
        changes: "object",
        verification: "object",
        pullRequest: "object",
        receipt: "object",
        approval: "object",
        transitions: "array",
      },
    },
    callbacks: {
      supported: true,
      method: "POST",
      field: "callbackUrl",
      note: "Best-effort webhook on awaiting_approval and terminal states. Polling remains authoritative.",
    },
    limitations: [
      "Public GitHub repositories only",
      "JavaScript/TypeScript focus",
      "Max ZIP 25MB, 5000 files",
      "No automatic merge to main",
      "GitHub PR tasks require explicit approval",
      "OKX Green PR orders require an accepted repodiet.contract/v1 digest",
      "Repo Guard monitors connected repositories after merges and on schedule",
    ],
    safetyPolicies: [
      "Routes, configs, env files, lockfiles, and API handlers are protected by default",
      "Only safe_candidate findings are auto-fixed in free proof",
      "verification_failed tasks are never marked completed",
      "Fallback analyzer results are labeled honestly",
    ],
    internalRoles: [
      "orchestrator",
      "repository_analyzer",
      "safety_classifier",
      "fix_executor",
      "verification_worker",
      "github_delivery_worker",
      "receipt_signer",
    ],
  };
}
