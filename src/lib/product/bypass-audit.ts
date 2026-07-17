/**
 * Classification of owner/repo-specific references.
 * Production runtime must not grant special authorization from these names.
 *
 * Categories:
 * - docs_only: marketing/docs/UI links
 * - validation_target: tests/scripts only
 * - demo_explicit: explicit demo product (repodiet/demo-slop-app), never free under live_x402
 * - owner_tooling: one-off repair helpers (must not be marketplace path)
 * - removed_from_runtime: was production special-case; must not affect behavior
 */

export type OccurrenceClass =
  | "docs_only"
  | "validation_target"
  | "demo_explicit"
  | "owner_tooling"
  | "user_agent_string"
  | "test_only"
  | "removed_from_runtime";

export interface ProductionBypassAuditEntry {
  pattern: string;
  locations: string[];
  classification: OccurrenceClass;
  productionEffect: "none" | "must_remain_neutral" | "gated_non_production" | "owner_tool_not_marketplace";
}

export const PRODUCTION_BYPASS_AUDIT: ProductionBypassAuditEntry[] = [
  {
    pattern: "velz-cmd/Meridian",
    locations: [
      "src/lib/product/proof-repositories.ts",
      "scripts/meridian-*.ts",
      "test/*",
    ],
    classification: "validation_target",
    productionEffect: "none",
  },
  {
    pattern: "smokychain22/agentPass",
    locations: [
      "src/lib/product/proof-repositories.ts",
      "src/lib/app/production-url.ts",
      "components docs/header GitHub links",
    ],
    classification: "docs_only",
    productionEffect: "none",
  },
  {
    pattern: "repodiet-e2e-test",
    locations: ["src/lib/scanner/prepare-workspace.ts", "test/*", "scripts/*"],
    classification: "validation_target",
    productionEffect: "gated_non_production",
  },
  {
    pattern: "repodiet/demo-slop-app",
    locations: ["src/lib/demo/constants.ts", "UI demo buttons"],
    classification: "demo_explicit",
    productionEffect: "must_remain_neutral",
  },
  {
    pattern: "applyMeridianBaselineRepair",
    locations: ["src/lib/github/repository-repair.ts", "src/app/api/github/repository-repair/route.ts"],
    classification: "owner_tooling",
    productionEffect: "owner_tool_not_marketplace",
  },
  {
    pattern: "REPODIET_OWNER_BUYER_WALLET",
    locations: ["src/lib/wallet/owner-buyer-wallet.ts", "src/lib/workflow/payment-ui.ts"],
    classification: "demo_explicit",
    productionEffect: "must_remain_neutral",
  },
];

/** Runtime guard: never treat a repository name as privileged. */
export function isPrivilegedRepository(_owner: string, _name: string): false {
  return false;
}
