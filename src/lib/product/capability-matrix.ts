/**
 * Product capability matrix — tested vs production-proven, without false readiness.
 */

export type CapabilityProofLevel =
  | "implemented"
  | "tested_locally"
  | "tested_in_ci"
  | "tested_in_production"
  | "real_external_action_proven";

export interface ProductCapabilityRow {
  id: string;
  label: string;
  implemented: boolean;
  testedLocally: boolean;
  testedInCi: boolean;
  testedInProduction: boolean;
  realExternalActionProven: boolean;
  remainingLimitation: string;
}

export interface ProductCapabilityMatrix {
  version: string;
  capabilities: ProductCapabilityRow[];
}

export const PRODUCT_CAPABILITY_MATRIX: ProductCapabilityMatrix = {
  version: "repodiet-capability-v1",
  capabilities: [
    {
      id: "tracked_path_inventory",
      label: "Pinned-commit tracked path inventory",
      implemented: true,
      testedLocally: true,
      testedInCi: true,
      testedInProduction: true,
      realExternalActionProven: false,
      remainingLimitation: "Production inventory proven via scans; not every edge path type canaried live.",
    },
    {
      id: "js_ts_semantic_analysis",
      label: "JS/TS/React/Node semantic analysis",
      implemented: true,
      testedLocally: true,
      testedInCi: true,
      testedInProduction: true,
      realExternalActionProven: true,
      remainingLimitation: "Depends on knip/jscpd/madge succeeding; fallback is labelled honestly.",
    },
    {
      id: "exact_duplicate_consolidation",
      label: "Exact duplicate consolidation with reference rewrite",
      implemented: true,
      testedLocally: true,
      testedInCi: true,
      testedInProduction: false,
      realExternalActionProven: false,
      remainingLimitation: "Fixture-proven; live customer-repo PR canary still required for PRODUCTION_READY.",
    },
    {
      id: "user_directed_plan_before_pay",
      label: "Exact plan + unified diff before payment",
      implemented: true,
      testedLocally: true,
      testedInCi: true,
      testedInProduction: false,
      realExternalActionProven: false,
      remainingLimitation: "Dynamic quotes and empty-patch rejection tested; live paid plan binding canary pending.",
    },
    {
      id: "isolated_validation",
      label: "Isolated baseline/patched validation",
      implemented: true,
      testedLocally: true,
      testedInCi: true,
      testedInProduction: false,
      realExternalActionProven: false,
      remainingLimitation: "Sandbox/worker validation proven in fixtures; production evidence must be persisted per task.",
    },
    {
      id: "github_app_pr_delivery",
      label: "GitHub App branch + PR delivery without customer CLI",
      implemented: true,
      testedLocally: true,
      testedInCi: true,
      testedInProduction: false,
      realExternalActionProven: false,
      remainingLimitation: "Requires owner-authorized canary repository install; missing-token must never count as success.",
    },
    {
      id: "a2mcp_paid_analyze_repository",
      label: "A2MCP analyze_repository with real x402 + signed receipt",
      implemented: true,
      testedLocally: true,
      testedInCi: true,
      testedInProduction: true,
      realExternalActionProven: false,
      remainingLimitation: "HTTP 402 proven on production; full paid canary requires wallet signature and receipt verify.",
    },
    {
      id: "a2a_escrow_lifecycle",
      label: "A2A discovery → escrow → PR → acceptance → release",
      implemented: true,
      testedLocally: true,
      testedInCi: true,
      testedInProduction: false,
      realExternalActionProven: false,
      remainingLimitation: "Discovery ack proven live; full escrow release canary not yet evidenced in durable production record.",
    },
    {
      id: "non_js_language_detection",
      label: "Non-JS ecosystem detection with honest analysis level",
      implemented: true,
      testedLocally: true,
      testedInCi: true,
      testedInProduction: false,
      realExternalActionProven: false,
      remainingLimitation: "Detected and inventoried; not semantically analyzed or auto-fixed.",
    },
  ],
};
