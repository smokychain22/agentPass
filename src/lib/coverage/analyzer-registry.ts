/**
 * Canonical analyzer registry — Phase 1 wraps existing JS/TS analyzers as adapters.
 * Declared capabilities drive the fallback chain; they do not expand semantic languages yet.
 */
import type { AnalyzerLayer } from "./types";

export type AnalyzerId =
  | "knip"
  | "madge"
  | "jscpd"
  | "internal_import_graph"
  | "internal_dependency_graph"
  | "internal_duplicate_detector"
  | "exact_content_duplicate"
  | "empty_file_hygiene"
  | "unused_import_scan"
  | "ai_slop_heuristics"
  | "structural_json"
  | "textual_fallback"
  | "metadata_fallback"
  | "binary_inspector";

export interface AnalyzerDescriptor {
  id: AnalyzerId;
  version: string;
  layer: AnalyzerLayer;
  supportedLanguages: string[];
  supportedFormats: string[];
  supportedFileKinds: string[];
  repositoryTopologyRequirements: string[];
  maximumFileSizeBytes: number;
  requiresMaterialization: boolean;
  createsFindings: boolean;
  /** Phase 1: only existing transformers may contribute eligibility — keep false for new layers. */
  canContributeCleanupEligibility: boolean;
  fallbackAnalyzers: AnalyzerId[];
  timeoutMs: number;
  memoryPolicy: string;
}

const KB = 1024;
const MB = 1024 * KB;

export const ANALYZER_REGISTRY: Record<AnalyzerId, AnalyzerDescriptor> = {
  knip: {
    id: "knip",
    version: "native",
    layer: "semantic",
    supportedLanguages: ["javascript", "typescript"],
    supportedFormats: ["js", "ts", "jsx", "tsx", "mjs", "cjs"],
    supportedFileKinds: ["supported_source", "configuration"],
    repositoryTopologyRequirements: ["package.json"],
    maximumFileSizeBytes: 2 * MB,
    requiresMaterialization: true,
    createsFindings: true,
    canContributeCleanupEligibility: true,
    fallbackAnalyzers: ["internal_import_graph", "textual_fallback", "metadata_fallback"],
    timeoutMs: 120_000,
    memoryPolicy: "cli_child_process",
  },
  madge: {
    id: "madge",
    version: "native",
    layer: "semantic",
    supportedLanguages: ["javascript", "typescript"],
    supportedFormats: ["js", "ts", "jsx", "tsx", "mjs", "cjs"],
    supportedFileKinds: ["supported_source"],
    repositoryTopologyRequirements: [],
    maximumFileSizeBytes: 2 * MB,
    requiresMaterialization: true,
    createsFindings: true,
    canContributeCleanupEligibility: false,
    fallbackAnalyzers: ["internal_dependency_graph", "textual_fallback", "metadata_fallback"],
    timeoutMs: 120_000,
    memoryPolicy: "cli_child_process",
  },
  jscpd: {
    id: "jscpd",
    version: "native",
    layer: "semantic",
    supportedLanguages: ["javascript", "typescript"],
    supportedFormats: ["js", "ts", "jsx", "tsx", "mjs", "cjs"],
    supportedFileKinds: ["supported_source"],
    repositoryTopologyRequirements: [],
    maximumFileSizeBytes: 2 * MB,
    requiresMaterialization: true,
    createsFindings: true,
    canContributeCleanupEligibility: false,
    fallbackAnalyzers: ["internal_duplicate_detector", "textual_fallback", "metadata_fallback"],
    timeoutMs: 120_000,
    memoryPolicy: "cli_child_process",
  },
  internal_import_graph: {
    id: "internal_import_graph",
    version: "1",
    layer: "semantic",
    supportedLanguages: ["javascript", "typescript"],
    supportedFormats: ["js", "ts", "jsx", "tsx", "mjs", "cjs", "json"],
    supportedFileKinds: ["supported_source", "configuration"],
    repositoryTopologyRequirements: [],
    maximumFileSizeBytes: 2 * MB,
    requiresMaterialization: true,
    createsFindings: true,
    canContributeCleanupEligibility: true,
    fallbackAnalyzers: ["textual_fallback", "metadata_fallback"],
    timeoutMs: 60_000,
    memoryPolicy: "in_process_capped_2500_files",
  },
  internal_dependency_graph: {
    id: "internal_dependency_graph",
    version: "1",
    layer: "semantic",
    supportedLanguages: ["javascript", "typescript"],
    supportedFormats: ["js", "ts", "jsx", "tsx", "mjs", "cjs"],
    supportedFileKinds: ["supported_source"],
    repositoryTopologyRequirements: [],
    maximumFileSizeBytes: 2 * MB,
    requiresMaterialization: true,
    createsFindings: true,
    canContributeCleanupEligibility: false,
    fallbackAnalyzers: ["textual_fallback", "metadata_fallback"],
    timeoutMs: 60_000,
    memoryPolicy: "in_process",
  },
  internal_duplicate_detector: {
    id: "internal_duplicate_detector",
    version: "1",
    layer: "semantic",
    supportedLanguages: ["javascript", "typescript"],
    supportedFormats: ["js", "ts", "jsx", "tsx", "mjs", "cjs"],
    supportedFileKinds: ["supported_source"],
    repositoryTopologyRequirements: [],
    maximumFileSizeBytes: 1 * MB,
    requiresMaterialization: true,
    createsFindings: true,
    canContributeCleanupEligibility: false,
    fallbackAnalyzers: ["textual_fallback", "metadata_fallback"],
    timeoutMs: 60_000,
    memoryPolicy: "in_process_capped_400_files",
  },
  exact_content_duplicate: {
    id: "exact_content_duplicate",
    version: "1",
    layer: "structural",
    supportedLanguages: ["javascript", "typescript"],
    supportedFormats: ["js", "ts", "jsx", "tsx", "mjs", "cjs"],
    supportedFileKinds: ["supported_source"],
    repositoryTopologyRequirements: [],
    maximumFileSizeBytes: 2 * MB,
    requiresMaterialization: true,
    createsFindings: true,
    canContributeCleanupEligibility: true,
    fallbackAnalyzers: ["textual_fallback", "metadata_fallback"],
    timeoutMs: 60_000,
    memoryPolicy: "in_process",
  },
  empty_file_hygiene: {
    id: "empty_file_hygiene",
    version: "1",
    layer: "textual",
    supportedLanguages: ["javascript", "typescript"],
    supportedFormats: ["js", "ts", "jsx", "tsx", "mjs", "cjs"],
    supportedFileKinds: ["supported_source"],
    repositoryTopologyRequirements: [],
    maximumFileSizeBytes: 64 * KB,
    requiresMaterialization: true,
    createsFindings: true,
    canContributeCleanupEligibility: true,
    fallbackAnalyzers: ["metadata_fallback"],
    timeoutMs: 30_000,
    memoryPolicy: "in_process",
  },
  unused_import_scan: {
    id: "unused_import_scan",
    version: "1",
    layer: "semantic",
    supportedLanguages: ["javascript", "typescript"],
    supportedFormats: ["js", "ts", "jsx", "tsx"],
    supportedFileKinds: ["supported_source"],
    repositoryTopologyRequirements: [],
    maximumFileSizeBytes: 2 * MB,
    requiresMaterialization: true,
    createsFindings: true,
    canContributeCleanupEligibility: true,
    fallbackAnalyzers: ["textual_fallback", "metadata_fallback"],
    timeoutMs: 60_000,
    memoryPolicy: "in_process",
  },
  ai_slop_heuristics: {
    id: "ai_slop_heuristics",
    version: "1",
    layer: "textual",
    supportedLanguages: ["javascript", "typescript"],
    supportedFormats: ["js", "ts", "jsx", "tsx", "mjs", "cjs"],
    supportedFileKinds: ["supported_source"],
    repositoryTopologyRequirements: [],
    maximumFileSizeBytes: 1 * MB,
    requiresMaterialization: true,
    createsFindings: true,
    canContributeCleanupEligibility: false,
    fallbackAnalyzers: ["metadata_fallback"],
    timeoutMs: 60_000,
    memoryPolicy: "in_process_capped_8000_files",
  },
  structural_json: {
    id: "structural_json",
    version: "1",
    layer: "structural",
    supportedLanguages: [],
    supportedFormats: ["json", "jsonc"],
    supportedFileKinds: ["configuration", "lockfile"],
    repositoryTopologyRequirements: [],
    maximumFileSizeBytes: 8 * MB,
    requiresMaterialization: true,
    createsFindings: false,
    canContributeCleanupEligibility: false,
    fallbackAnalyzers: ["textual_fallback", "metadata_fallback"],
    timeoutMs: 15_000,
    memoryPolicy: "in_process",
  },
  textual_fallback: {
    id: "textual_fallback",
    version: "1",
    layer: "textual",
    supportedLanguages: ["*"],
    supportedFormats: ["*"],
    supportedFileKinds: ["*"],
    repositoryTopologyRequirements: [],
    maximumFileSizeBytes: 2 * MB,
    requiresMaterialization: true,
    createsFindings: false,
    canContributeCleanupEligibility: false,
    fallbackAnalyzers: ["metadata_fallback"],
    timeoutMs: 10_000,
    memoryPolicy: "in_process_sample_head",
  },
  metadata_fallback: {
    id: "metadata_fallback",
    version: "1",
    layer: "metadata",
    supportedLanguages: ["*"],
    supportedFormats: ["*"],
    supportedFileKinds: ["*"],
    repositoryTopologyRequirements: [],
    maximumFileSizeBytes: Number.MAX_SAFE_INTEGER,
    requiresMaterialization: false,
    createsFindings: false,
    canContributeCleanupEligibility: false,
    fallbackAnalyzers: [],
    timeoutMs: 1_000,
    memoryPolicy: "git_tree_only",
  },
  binary_inspector: {
    id: "binary_inspector",
    version: "1",
    layer: "metadata",
    supportedLanguages: [],
    supportedFormats: ["bin", "png", "jpg", "gif", "webp", "woff", "woff2", "pdf", "zip"],
    supportedFileKinds: ["binary", "asset"],
    repositoryTopologyRequirements: [],
    maximumFileSizeBytes: 50 * MB,
    requiresMaterialization: false,
    createsFindings: false,
    canContributeCleanupEligibility: false,
    fallbackAnalyzers: ["metadata_fallback"],
    timeoutMs: 5_000,
    memoryPolicy: "hash_and_size_only",
  },
};

export function getAnalyzer(id: AnalyzerId): AnalyzerDescriptor {
  return ANALYZER_REGISTRY[id];
}

export function listAnalyzers(): AnalyzerDescriptor[] {
  return Object.values(ANALYZER_REGISTRY);
}

export function analyzersForLayer(layer: AnalyzerLayer): AnalyzerDescriptor[] {
  return listAnalyzers().filter((a) => a.layer === layer);
}
