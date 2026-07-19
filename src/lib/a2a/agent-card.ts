import { getServerBaseUrl } from "@/lib/docs/base-url";
import { A2MCP_VERSION } from "@/lib/a2mcp/constants";
import { OKX_A2A_SERVICE, OKX_A2MCP_SERVICE } from "@/lib/marketing/content";
import type { A2ATaskType } from "./types";
import { getCanonicalOkxIdentity } from "@/lib/okx/identity";

export function buildAgentCard() {
  const baseUrl = getServerBaseUrl();
  const publicKey = process.env.REPODIET_OPERATOR_PUBLIC_KEY?.trim() ?? null;
  const identity = getCanonicalOkxIdentity();

  return {
    name: "RepoDiet",
    version: A2MCP_VERSION,
    description:
      "RepoDiet provides A2MCP Quick Triage (standardized x402 pay-per-call) and A2A Verified Cleanup PR (negotiated escrow delivery).",
    url: baseUrl,
    identity: {
      operator: "repodiet-operator",
      aspAgentId: String(identity.aspAgentId),
      a2aServiceId: String(identity.a2aServiceId),
      a2mcpServiceId: String(identity.a2mcpServiceId),
      service: OKX_A2A_SERVICE.name,
      category: "repository_maintenance",
    },
    operator: {
      id: "repodiet-operator",
      publicKey,
      signingAlgorithm: publicKey ? "RSA-SHA256" : null,
    },
    services: {
      a2mcp: {
        name: OKX_A2MCP_SERVICE.name,
        protocol: "A2MCP",
        serviceId: OKX_A2MCP_SERVICE.serviceId,
        operation: OKX_A2MCP_SERVICE.operation,
        price: OKX_A2MCP_SERVICE.price,
        settlement: OKX_A2MCP_SERVICE.settlement,
        description: OKX_A2MCP_SERVICE.description,
        endpoint: `${baseUrl}/api/a2mcp/quick-triage`,
      },
      a2a: {
        name: OKX_A2A_SERVICE.name,
        protocol: "A2A",
        serviceId: OKX_A2A_SERVICE.serviceId,
        operation: OKX_A2A_SERVICE.operation,
        price: OKX_A2A_SERVICE.price,
        defaultReferencePrice: OKX_A2A_SERVICE.defaultReferencePrice,
        settlement: OKX_A2A_SERVICE.settlement,
        description: OKX_A2A_SERVICE.description,
      },
    },
    supportedTaskTypes: [
      {
        type: "repository.analysis",
        description:
          "A2MCP Quick Triage — bounded analyze_repository returning up to five prioritized findings (0.03 USD₮0 via x402).",
        paymentRequired: true,
        priceHint: "0.03 USD₮0",
        protocol: "A2MCP",
      },
      {
        type: "repository.cleanup_pr",
        description:
          "A2A Verified Cleanup PR — customized create_cleanup_pr delivery with negotiated terms, escrow, and buyer acceptance (default reference 1 USD₮0).",
        paymentRequired: true,
        priceHint: "negotiated (default 1 USD₮0)",
        requiresApproval: true,
        protocol: "A2A",
      },
    ] satisfies Array<{
      type: A2ATaskType | "repository.analysis";
      description: string;
      paymentRequired: boolean;
      priceHint?: string;
      requiresApproval?: boolean;
      available?: boolean;
      protocol?: string;
    }>,
    authentication: {
      publicScan: "none",
      githubMutation: "github_app_installation_or_token",
      a2mcpPaidCalls: "x402_bound_quote",
      a2aPaidTasks: "negotiated_task_agreement_and_escrow",
    },
    payment: {
      a2mcp: {
        protocol: "x402",
        network: `X Layer (${identity.network})`,
        chainId: identity.chainId ?? null,
        asset: identity.settlementAsset,
        environment: identity.environment ?? "unset",
        paymentMode: identity.paymentMode ?? "unset",
        amount: "0.03 USD₮0",
        operation: "analyze_repository",
        quoteEndpoint: `${baseUrl}/api/tasks/quote`,
        payEndpoint: `${baseUrl}/api/tasks/pay`,
        enforcement: process.env.REQUIRE_REAL_X402 === "1" ? "strict" : "test_or_demo",
      },
      a2a: {
        protocol: "A2A_escrow",
        network: `X Layer (${identity.network})`,
        chainId: identity.chainId ?? null,
        asset: identity.settlementAsset,
        environment: identity.environment ?? "unset",
        paymentMode: identity.paymentMode ?? "unset",
        pricing: "negotiated",
        defaultReference: "1 USD₮0",
        settlement: "task_agreement_escrow_delivery_buyer_acceptance_release",
        operation: "create_cleanup_pr",
      },
      note: "Not all paid tasks use x402. A2MCP Quick Triage uses x402; A2A Verified Cleanup PR uses negotiated escrow.",
    },
    endpoints: {
      submitTask: `${baseUrl}/api/a2a/tasks`,
      createA2aOrder: `${baseUrl}/api/okx/a2a/orders`,
      quickTriage: `${baseUrl}/api/a2mcp/quick-triage`,
      proposeMaintenanceContract: `${baseUrl}/api/green-pr/contracts`,
      acceptMaintenanceContract: `${baseUrl}/api/green-pr/contracts/{contractId}/accept`,
      verifyAttestation: `${baseUrl}/api/attestations/verify`,
      taskStatus: `${baseUrl}/api/a2a/tasks/{taskId}`,
      a2aIntake: `${baseUrl}/api/okx/a2a/intake`,
      approveTask: `${baseUrl}/api/a2a/tasks/{taskId}/approve`,
      fundTask: `${baseUrl}/api/a2a/tasks/{taskId}/fund`,
      cancelTask: `${baseUrl}/api/a2a/tasks/{taskId}/cancel`,
      submitDeliveryEvidence: `${baseUrl}/api/okx/a2a/tasks/{taskId}/delivery`,
      buyerAcceptDelivery: `${baseUrl}/api/okx/a2a/tasks/{taskId}/accept`,
      recordEscrowRelease: `${baseUrl}/api/okx/a2a/tasks/{taskId}/release`,
      trustRoot: `${baseUrl}/api/okx/trust-root`,
      verifyReceipt: `${baseUrl}/api/okx/receipts/{receiptId}`,
      manifest: `${baseUrl}/api/tools/manifest`,
      health: `${baseUrl}/api/tools/health`,
      maintenanceContractSchema: `${baseUrl}/schemas/repodiet.contract.v1.schema.json`,
    },
    a2aLifecycle: [
      "buyer creates A2A task",
      "seller accepts or negotiates scope",
      "funds enter escrow",
      "RepoDiet creates a real Green PR",
      "seller submits delivery evidence",
      "buyer inspects and accepts",
      "escrow releases to seller",
      "receipt and task evidence are recorded",
    ],
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
      "A2A GitHub PR tasks require explicit buyer acceptance",
      "OKX Green PR orders require an accepted repodiet.contract/v1 digest",
      "A2MCP create_cleanup_pr is not a paid listing — cleanup PR delivery is A2A only",
    ],
    safetyPolicies: [
      "Routes, configs, env files, lockfiles, and API handlers are protected by default",
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
