import type { TerminalCoverageOutcome } from "./outcomes";

export type GitObjectType = "blob" | "tree" | "commit";

export type MaterializationStatus =
  | "MATERIALIZED"
  | "NOT_MATERIALIZED"
  | "SYMLINK_REPRESENTED"
  | "SUBMODULE_GITLINK"
  | "LFS_POINTER"
  | "MATERIALIZATION_FAILED_WITH_REASON";

export type AnalyzerLayer = "semantic" | "structural" | "textual" | "metadata";

export type AnalyzerAttemptStatus =
  | "SUCCESS"
  | "NOT_APPLICABLE"
  | "FAILED"
  | "RESOURCE_LIMITED"
  | "INPUT_UNAVAILABLE";

export interface ResourceLimitRecord {
  limitKind: string;
  limitValue: number;
  observedValue: number;
  pathExact?: string;
  layer?: AnalyzerLayer;
  reason?: string;
}

/** Planned analyzer layers for a single inventory path. */
export interface AnalyzerPlan {
  primaryLayer: AnalyzerLayer;
  fallbackLayers?: AnalyzerLayer[];
}

export interface AnalyzerAttempt {
  pathExact: string;
  layer: AnalyzerLayer;
  status: AnalyzerAttemptStatus;
  reason?: string;
  startedAt?: string;
  finishedAt?: string;
  resourceLimits?: ResourceLimitRecord[];
  owner?: string;
  repository?: string;
  pinnedCommitSha?: string;
}

export interface CoverageInventoryEntry {
  pathExact: string;
  pathNormalized: string;
  objectType: GitObjectType;
  objectSha: string;
  mode: string;
  executable: boolean;
  symlink: boolean;
  submodule: boolean;
  byteSize: number;
  materializationStatus: MaterializationStatus;
  materializationReason?: string;
  analyzerPlan: AnalyzerPlan;
  finalCoverageOutcome: TerminalCoverageOutcome;
  classificationReason?: string;
  matchingRule?: string;
  contentInspected?: boolean;
  modificationBlockedByPolicy?: boolean;
  repositoryId?: string;
  owner: string;
  repository: string;
  pinnedCommitSha: string;
  treeSha?: string;
}

export interface RepositoryTopologyManifestEntry {
  pathExact: string;
  pathNormalized: string;
  kind: string;
  framework?: string;
  packageManager?: string;
}

export interface RepositoryTopologyDiscovery {
  manifests: RepositoryTopologyManifestEntry[];
  projectRoots: string[];
  packageManagers: string[];
  frameworks: string[];
  submodulePaths: string[];
  lfsPointerPaths: string[];
}

export interface UniversalCoverageReport {
  coverageVersion: "phase1" | "legacy";
  trackedGitPaths: number;
  accountedForPaths: number;
  semanticPathCount: number;
  structuralPathCount: number;
  textualPathCount: number;
  metadataPathCount: number;
  binaryPathCount: number;
  generatedPathCount: number;
  vendoredPathCount: number;
  protectedPathCount: number;
  unreadablePathCount: number;
  analyzerFailurePathCount: number;
  materializationMismatchCount: number;
  accountingCoveragePercent: number;
  semanticCoveragePercent: number;
  structuralCoveragePercent: number;
  /** textual + metadata + binary + generated + vendored + protected + unreadable + analyzer_failed */
  fallbackCoveragePercent: number;
  claimsSemanticAnalysisOfAllFiles: boolean;
  inventory: CoverageInventoryEntry[];
  attempts: AnalyzerAttempt[];
  topology: RepositoryTopologyDiscovery;
  nonAuthoritativeWorktreeArtifacts: Array<{ path: string; reason: string }>;
  analyzerFailures: string[];
  unreadablePaths: string[];
  materializationMismatches: string[];
}

export type CoverageMetricsFromInventory = Omit<
  UniversalCoverageReport,
  "inventory" | "attempts" | "topology" | "nonAuthoritativeWorktreeArtifacts"
>;
