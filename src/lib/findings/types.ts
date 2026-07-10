export type FindingType =
  | "duplicate_code"
  | "unused_file"
  | "unused_dependency"
  | "unused_export"
  | "orphan_pattern"
  | "ai_slop_signal";

export type FindingSeverity = "low" | "medium" | "high";

export type FindingAction = "safe_candidate" | "review_first" | "do_not_touch";

export type FindingSource =
  | "knip"
  | "jscpd"
  | "madge"
  | "heuristic"
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
  error?: string;
  durationMs: number;
}

export interface AnalyzerRunResult<T> {
  status: ToolStatus;
  source: AnalyzerSource;
  sourceMode: SourceMode;
  report: T | null;
  error?: string;
  durationMs: number;
}

export interface FindingEvidence {
  summary: string;
  signals: string[];
}

export interface Finding {
  id: string;
  type: FindingType;
  title: string;
  files: string[];
  packageName?: string;
  lines?: { start: number; end: number };
  confidence: number;
  confidenceReason: string;
  severity: FindingSeverity;
  action: FindingAction;
  reason: string;
  source: FindingSource;
  sourceMode: SourceMode;
  evidence: FindingEvidence;
}

export interface FindingsSummary {
  totalFindings: number;
  duplicateClusters: number;
  unusedFiles: number;
  unusedDependencies: number;
  unusedExports: number;
  orphanPatterns: number;
  slopSignals: number;
  reviewRequired: number;
  safeCandidates: number;
  doNotTouch: number;
}

export interface FindingsPayload {
  scanId: string;
  repo: {
    owner: string;
    name: string;
    branch: string;
    url?: string;
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
  rawToolReports: {
    knip: ToolRunReport;
    jscpd: ToolRunReport;
    madge: ToolRunReport;
  };
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
