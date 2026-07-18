export {
  TERMINAL_COVERAGE_OUTCOMES,
  TerminalCoverageOutcome,
  FORBIDDEN_BARE_OUTCOMES,
  assertValidTerminalOutcome,
  isForbiddenBareOutcome,
  isTerminalCoverageOutcome,
} from "./outcomes";
export type { ForbiddenBareOutcome, TerminalCoverageOutcome as TerminalCoverageOutcomeType } from "./outcomes";

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

export {
  fetchPinnedCommitTreeViaApi,
  listPinnedCommitTreeViaGit,
  loadPinnedCommitTree,
  parseGitLsTreeZ,
} from "./git-tree-inventory";
export type { GitTreeEntry, PinnedCommitTree } from "./git-tree-inventory";

export {
  normalizeRepoRelativePath,
  assertSafeRepoRelativePath,
} from "./path-normalize";

export {
  detectGeneratedPath,
  detectVendoredPath,
  detectBinaryExt,
  detectLfsPointerContent,
  detectSymlinkMode,
  detectGitlinkMode,
  detectProtectedPath,
  planAnalyzersForPath,
  analyzerPlanFromLayers,
  classifyTrackedPath,
} from "./classify-path";
export type {
  PlanAnalyzersOptions,
  ClassifyTrackedPathInput,
  ClassifyTrackedPathResult,
} from "./classify-path";

export { reconcileGitTreeWithWorktree } from "./worktree-reconcile";
export type {
  ReconcileGitTreeInput,
  ReconcileGitTreeResult,
} from "./worktree-reconcile";

export { discoverRepositoryTopology } from "./topology";

export { buildUniversalCoverageReport } from "./build-coverage-report";
export type { BuildUniversalCoverageReportArgs } from "./build-coverage-report";

export { ANALYZER_REGISTRY, getAnalyzer, listAnalyzers, analyzersForLayer } from "./analyzer-registry";
export type { AnalyzerId, AnalyzerDescriptor } from "./analyzer-registry";

export {
  FALLBACK_LAYER_ORDER,
  nextFallbackLayer,
  layersFromPlan,
  outcomeForSuccessfulLayer,
  applyFallbackChainToInventory,
  makeAttempt,
} from "./fallback-chain";

export { runUniversalCoverage, legacyCoverageReport } from "./run-universal-coverage";
export type { RunUniversalCoverageInput } from "./run-universal-coverage";
