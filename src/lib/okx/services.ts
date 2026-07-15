import type { A2aServiceId, A2mcpServiceId, OkxServiceDefinition } from "./types";
import { getAnalyzeRepositoryPrice } from "@/lib/payment/analyze-repository-price";

const analyzeRepositoryPrice = getAnalyzeRepositoryPrice();

export const A2MCP_SERVICES: Record<A2mcpServiceId, OkxServiceDefinition> = {
  scan_repository: {
    serviceId: "scan_repository",
    serviceType: "A2MCP",
    operation: "scan_repository",
    label: "Scan Repository",
    description: "Framework, projects, files, package manager detection.",
    amountMicro: "10000",
    priceLabel: "0.01 USDT",
    readOnly: true,
    requiresEscrow: false,
    requiresApproval: false,
  },
  analyze_repository: {
    serviceId: "analyze_repository",
    serviceType: "A2MCP",
    operation: "analyze_repository",
    label: "A2MCP Quick Triage",
    description:
      "Bounded repository triage returning up to five prioritized findings. Live x402 on X Layer.",
    amountMicro: analyzeRepositoryPrice.amountMicro,
    priceLabel: analyzeRepositoryPrice.priceLabel.replace(/USDT/g, "USD₮0"),
    readOnly: true,
    requiresEscrow: false,
    requiresApproval: false,
  },
  list_safe_fixes: {
    serviceId: "list_safe_fixes",
    serviceType: "A2MCP",
    operation: "list_safe_fixes",
    label: "List Safe Fixes",
    description: "Deterministically supported automatic fixes.",
    amountMicro: "10000",
    priceLabel: "0.01 USDT",
    readOnly: true,
    requiresEscrow: false,
    requiresApproval: false,
  },
  verify_patch: {
    serviceId: "verify_patch",
    serviceType: "A2MCP",
    operation: "verify_patch",
    label: "Verify Patch",
    description: "Baseline comparison and verification for a patch.",
    amountMicro: "50000",
    priceLabel: "0.05 USDT",
    readOnly: true,
    requiresEscrow: false,
    requiresApproval: false,
  },
  repository_health_delta: {
    serviceId: "repository_health_delta",
    serviceType: "A2MCP",
    operation: "repository_health_delta",
    label: "Repository Health Delta",
    description: "New, resolved and recurring debt between two commits.",
    amountMicro: "30000",
    priceLabel: "0.03 USDT",
    readOnly: true,
    requiresEscrow: false,
    requiresApproval: false,
  },
};

export const A2A_SERVICES: Record<A2aServiceId, OkxServiceDefinition> = {
  verified_cleanup_pr: {
    serviceId: "verified_cleanup_pr",
    serviceType: "A2A",
    operation: "verified_cleanup_pr",
    label: "A2A Verified Cleanup PR",
    description:
      "Customized repository cleanup delivered as a review-ready GitHub pull request (operation create_cleanup_pr). Negotiated A2A escrow delivery; default reference 1 USD₮0.",
    amountMicro: "1000000",
    priceLabel: "negotiated (default 1 USD₮0)",
    readOnly: false,
    requiresEscrow: true,
    requiresApproval: true,
  },
  deep_cleanup_review: {
    serviceId: "deep_cleanup_review",
    serviceType: "A2A",
    operation: "verified_cleanup_pr",
    label: "Deep Cleanup Review (legacy alias)",
    description:
      "Legacy A2A alias — public OKX listing uses Verified Cleanup PR (32947) with negotiated pricing.",
    amountMicro: "1000000",
    priceLabel: "negotiated (default 1 USD₮0)",
    readOnly: false,
    requiresEscrow: true,
    requiresApproval: true,
  },
  repo_guard_mission: {
    serviceId: "repo_guard_mission",
    serviceType: "A2A",
    operation: "repo_guard",
    label: "Repo Guard Mission (not an OKX listing)",
    description:
      "Not part of the public OKX two-service model. Public listings are A2MCP Quick Triage and A2A Verified Cleanup PR only.",
    amountMicro: "0",
    priceLabel: "not listed",
    readOnly: false,
    requiresEscrow: true,
    requiresApproval: true,
  },
};

export function getA2mcpService(serviceId: string): OkxServiceDefinition | undefined {
  return A2MCP_SERVICES[serviceId as A2mcpServiceId];
}

export function getA2aService(serviceId: string): OkxServiceDefinition | undefined {
  return A2A_SERVICES[serviceId as A2aServiceId];
}

export function getOkxService(serviceId: string): OkxServiceDefinition | undefined {
  return getA2mcpService(serviceId) ?? getA2aService(serviceId);
}

export function isPaidA2mcpService(serviceId: string): boolean {
  const svc = getA2mcpService(serviceId);
  return Boolean(svc && svc.amountMicro !== "0");
}

export function listOkxServices(): OkxServiceDefinition[] {
  return [...Object.values(A2MCP_SERVICES), ...Object.values(A2A_SERVICES)];
}
