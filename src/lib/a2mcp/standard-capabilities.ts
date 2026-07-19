/**
 * Standardized A2MCP capability names for OKX deterministic services.
 * Aliases map to existing Phase 3 tools where possible.
 */

export const A2MCP_STANDARD_CAPABILITIES = [
  "scan_repository",
  "get_scan_status",
  "get_repository_coverage",
  "list_findings",
  "get_finding_evidence",
  "prepare_cleanup_plan",
  "get_plan_status",
  "get_delivery_status",
] as const;

export type A2mcpStandardCapability = (typeof A2MCP_STANDARD_CAPABILITIES)[number];

/** Canonical → existing tool / route mapping */
export const A2MCP_CAPABILITY_ALIASES: Record<
  A2mcpStandardCapability,
  { endpoint: string; underlying?: string; readOnly: boolean }
> = {
  scan_repository: {
    endpoint: "/api/tools/scan_repository",
    underlying: "scan_repository",
    readOnly: true,
  },
  get_scan_status: {
    endpoint: "/api/tools/get_scan_status",
    underlying: "get_task_status",
    readOnly: true,
  },
  get_repository_coverage: {
    endpoint: "/api/tools/get_repository_coverage",
    underlying: "get_repository_health",
    readOnly: true,
  },
  list_findings: {
    endpoint: "/api/tools/list_findings",
    underlying: "get_findings",
    readOnly: true,
  },
  get_finding_evidence: {
    endpoint: "/api/tools/get_finding_evidence",
    readOnly: true,
  },
  prepare_cleanup_plan: {
    endpoint: "/api/tools/prepare_cleanup_plan",
    readOnly: true,
  },
  get_plan_status: {
    endpoint: "/api/tools/get_plan_status",
    readOnly: true,
  },
  get_delivery_status: {
    endpoint: "/api/tools/get_delivery_status",
    readOnly: true,
  },
};
