export {
  TERMINAL_COVERAGE_OUTCOMES,
  TerminalCoverageOutcome,
  FORBIDDEN_BARE_OUTCOMES,
  assertValidTerminalOutcome,
  isForbiddenBareOutcome,
  isTerminalCoverageOutcome,
} from "./outcomes";
export type { ForbiddenBareOutcome } from "./outcomes";

export type {
  GitObjectType,
  MaterializationStatus,
  AnalyzerLayer,
  AnalyzerAttemptStatus,
  ResourceLimitRecord,
  AnalyzerPlan,
  AnalyzerAttempt,
  CoverageInventoryEntry,
  RepositoryTopologyManifestEntry,
  RepositoryTopologyDiscovery,
  UniversalCoverageReport,
  CoverageMetricsFromInventory,
} from "./types";

export { assertCoverageInvariants } from "./invariants";
export { buildCoverageMetrics } from "./metrics";
