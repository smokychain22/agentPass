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
    label: "Analyze Repository",
    description: "Findings with evidence and risk buckets.",
    amountMicro: analyzeRepositoryPrice.amountMicro,
    priceLabel: analyzeRepositoryPrice.priceLabel,
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
    label: "Verified Cleanup PR",
    description: "Analyze, verify retained fixes, open review-ready GitHub PR.",
    amountMicro: "2000000",
    priceLabel: "1–3 USDT",
    readOnly: false,
    requiresEscrow: true,
    requiresApproval: true,
  },
  deep_cleanup_review: {
    serviceId: "deep_cleanup_review",
    serviceType: "A2A",
    operation: "verified_cleanup_pr",
    label: "Deep Cleanup Review",
    description: "Cross-project duplicates, architectural cleanup, guided proposals.",
    amountMicro: "5000000",
    priceLabel: "3–8 USDT",
    readOnly: false,
    requiresEscrow: true,
    requiresApproval: true,
  },
  repo_guard_mission: {
    serviceId: "repo_guard_mission",
    serviceType: "A2A",
    operation: "repo_guard",
    label: "Repo Guard Mission",
    description: "Time-bounded monitoring, delta analysis, verified PR when justified.",
    amountMicro: "4000000",
    priceLabel: "3–5 USDT",
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
