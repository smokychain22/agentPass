export type FindingType =
  | "duplicate_code"
  | "unused_file"
  | "unused_dependency"
  | "unused_export"
  | "unused_import"
  | "orphan_pattern"
  | "ai_slop_signal";

export type FindingSeverity = "low" | "medium" | "high";

export type FindingAction = "safe_candidate" | "review_first" | "do_not_touch";

export type FindingSource =
  | "knip"
  | "jscpd"
  | "madge"
  | "heuristic"
  | "repodiet_import"
  | "repodiet_exact_dup"
  | "repodiet_hygiene"
  | "knip_fallback"
  | "jscpd_fallback"
  | "madge_fallback";

export type ToolStatus = "ok" | "fallback" | "failed";

export type SourceMode = "native" | "fallback" | "heuristic";

export type AnalyzerSource =
  | "knip"
  | "jscpd"
  | "madge"
  | "internal_import_graph"
  | "internal_duplicate_detector"
  | "internal_dependency_graph"
  | null;

export interface ToolRunReport {
  status: ToolStatus;
  source: AnalyzerSource;
  sourceMode: SourceMode;
  version?: string;
  diagnosticId?: string;
  error?: string;
  durationMs: number;
  command?: string;
  exitCode?: number | null;
}

export type AnalyzerAvailabilityStatus = "available" | "unavailable" | "failed";

export interface AnalyzerState {
  status: AnalyzerAvailabilityStatus;
  tool: "knip" | "jscpd" | "madge" | "repodiet_heuristics";
  version?: string;
  command?: string;
  exitCode?: number | null;
  durationMs: number;
  errorSummary?: string;
}

export interface FindingsDiagnostics {
  fallbackFindings: Finding[];
  excludedCounts: {
    duplicates: number;
    unusedFiles: number;
    unusedDependencies: number;
    unusedExports: number;
    orphans: number;
  };
  analyzerErrors: Partial<Record<"knip" | "jscpd" | "madge", string>>;
}

export interface AnalyzerRunResult<T> {
  status: ToolStatus;
  source: AnalyzerSource;
  sourceMode: SourceMode;
  report: T | null;
  error?: string;
  version?: string;
  durationMs: number;
}

export interface FindingEvidence {
  summary: string;
  signals: string[];
}

export type FindingLifecycleState =
  | "detected"
  | "supported"
  | "generated"
  | "validated"
  | "verified"
  | "approved"
  | "delivered";

export type EvidenceGrade = "strong" | "moderate" | "weak";

export type FusionEvidenceGrade =
  | "strong"
  | "moderate"
  | "weak"
  | "contradictory"
  | "insufficient";

export type ClassificationState =
  | "signal"
  | "candidate"
  | "corroborated"
  | "supported"
  | "review_required"
  | "protected"
  | "insufficient_evidence";

export type ClassificationLabel =
  | "potentially_unreferenced"
  | "confirmed_unused"
  | "eligible_for_removal"
  | "potential_orphan"
  | "exact_duplicate"
  | "structural_duplicate"
  | "near_duplicate"
  | "unused_import_confirmed"
  | "unused_dependency_suspected"
  | "backup_archive_candidate"
  | "stale_looking"
  | "possible_issue"
  | "protected"
  | "review_required";

export interface EvidenceItem {
  channel: string;
  source: string;
  summary: string;
  strength: "supporting" | "contradicting" | "neutral";
}

export interface EvidenceBundle {
  analyzerEvidence: EvidenceItem[];
  graphEvidence: EvidenceItem[];
  frameworkEvidence: EvidenceItem[];
  configurationEvidence: EvidenceItem[];
  scriptEvidence: EvidenceItem[];
  runtimeEvidence: EvidenceItem[];
  gitEvidence: EvidenceItem[];
  counterEvidence: EvidenceItem[];
  unresolvedRisks: string[];
  grade: FusionEvidenceGrade;
  classificationState: ClassificationState;
  classificationLabel: ClassificationLabel;
  decisionReason: string;
  autoFixAllowed: boolean;
}

export interface DeletionProof {
  findingId: string;
  filePath: string;
  commitSha?: string;
  whyBelievedUnnecessary: string;
  analyzersAgreeing: string[];
  entryPointsChecked: string[];
  importsChecked: boolean;
  dynamicReferencesChecked: boolean;
  configsChecked: boolean;
  scriptsChecked: boolean;
  packageExportsChecked: boolean;
  frameworkConventionsChecked: boolean;
  protected: boolean;
  protectionReason?: string;
  gitHistoryNote?: string;
  behaviorDependency?: string;
  verificationRequired: string[];
  evidenceGrade: FusionEvidenceGrade;
  approvedForAutomaticDeletion: boolean;
}

export interface Finding {
  id: string;
  type: FindingType;
  title: string;
  files: string[];
  packageName?: string;
  manifestPath?: string;
  dependencySection?: "dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies";
  analyzerEvidence?: string;
  lines?: { start: number; end: number };
  confidence: number;
  confidenceReason: string;
  severity: FindingSeverity;
  action: FindingAction;
  reason: string;
  source: FindingSource;
  sourceMode: SourceMode;
  evidence: FindingEvidence;
  lifecycleState?: FindingLifecycleState;
  evidenceGrade?: EvidenceGrade;
  evidenceBundle?: EvidenceBundle;
  deletionProof?: DeletionProof;
  classificationState?: ClassificationState;
  classificationLabel?: ClassificationLabel;
  supportedTransformer?: string | null;
  protected?: boolean;
  protectionReason?: string;
  suggestedAction?: string;
  projectRoot?: string;
}

export interface FindingsSummary {
  totalFindings: number;
  /** Verified findings from successful analyzers only (strict mode). */
  verifiedFindings?: number;
  duplicateClusters: number;
  unusedFiles: number;
  unusedDependencies: number;
  unusedExports: number;
  orphanPatterns: number;
  slopSignals: number;
  reviewRequired: number;
  safeCandidates: number;
  actionableFixes?: number;
  detectedFindings?: number;
  doNotTouch: number;
  /** @deprecated Use eligibleFindings */
  supportedFixes?: number;
  /** @deprecated Use eligibleFindings */
  transformerCompatible?: number;
  /** @deprecated Use transformedFindings */
  dryRunPassed?: number;
  eligibleFindings?: number;
  transformedFindings?: number;
  reviewRequiredFindings?: number;
  protectedFindings?: number;
}

export interface FindingsPayload {
  scanId: string;
  repo: {
    owner: string;
    name: string;
    branch: string;
    url?: string;
    commitSha?: string;
    githubRepositoryId?: number;
    previousOwner?: string;
    previousName?: string;
  };
  summary: FindingsSummary;
  duplicates: Finding[];
  unused: {
    files: Finding[];
    dependencies: Finding[];
    exports: Finding[];
  };
  orphans: Finding[];
  slopSignals: Finding[];
  riskBuckets: {
    safeDelete: string[];
    reviewFirst: string[];
    doNotTouch: string[];
  };
  artifacts: {
    findingsJson: boolean;
  };
  mode: "demo" | "live";
  analysisLineage?: {
    workspaceSource: "github_zip" | "local_demo" | "e2e_fixture";
    analyzedAt: string;
    projectRoot?: string;
    scanId?: string;
  };
  repositoryModel?: {
    projects: Array<Record<string, unknown>>;
    workspaces: string[];
    monorepoTool?: string | null;
    primaryProjectRoot?: string;
    excludedProjectRoots?: string[];
  };
  rawToolReports: {
    knip: ToolRunReport;
    jscpd: ToolRunReport;
    madge: ToolRunReport;
  };
  analyzerStates?: {
    knip: AnalyzerState;
    jscpd: AnalyzerState;
    madge: AnalyzerState;
    heuristics: AnalyzerState;
  };
  diagnostics?: FindingsDiagnostics;
}

export interface KnipRawReport {
  issues?: KnipIssue[];
}

export interface KnipIssue {
  file: string;
  files?: { name: string }[];
  dependencies?: { name: string }[];
  devDependencies?: { name: string }[];
  exports?: { name: string }[];
}

export interface JscpdDuplicate {
  format?: string;
  lines?: number;
  firstFile?: {
    name: string;
    start: number;
    end: number;
  };
  secondFile?: {
    name: string;
    start: number;
    end: number;
  };
}

export interface JscpdRawReport {
  duplicates?: JscpdDuplicate[];
}

export interface MadgeRawReport {
  orphans: string[];
  circular: string[][];
}

export interface SlopRawSignal {
  title: string;
  files: string[];
  reason: string;
  confidence: number;
}

export const FindingsRunBodySchema = {
  parse(input: unknown): { repoUrl: string; branch?: string } {
    if (!input || typeof input !== "object") {
      throw new Error("Invalid request body.");
    }
    const body = input as Record<string, unknown>;
    if (typeof body.repoUrl !== "string" || !body.repoUrl.trim()) {
      throw new Error("repoUrl is required.");
    }
    return {
      repoUrl: body.repoUrl.trim(),
      branch: typeof body.branch === "string" ? body.branch.trim() : undefined,
    };
  },
};

export const TOOL_TIMEOUT_MS = 120_000;
export const MAX_SLOP_FILES = 8_000;

export const SKIP_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp4",
  ".webm",
  ".mp3",
  ".zip",
  ".pdf",
  ".bin",
  ".exe",
  ".dll",
]);
