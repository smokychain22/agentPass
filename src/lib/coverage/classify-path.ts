import path from "node:path";
import type { AnalyzerLayer, AnalyzerPlan } from "./types";
import type { TerminalCoverageOutcome } from "./outcomes";
import { normalizeRepoRelativePath } from "./path-normalize";

const GENERATED_DIR_NAMES = new Set([
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  ".cache",
  ".turbo",
  ".vercel",
  "storybook-static",
  "target",
  "__pycache__",
  ".pytest_cache",
  "Pods",
]);

const VENDOR_DIR_NAMES = new Set([
  "vendor",
  "third_party",
  "third-party",
  "vendored",
  "node_modules",
  "bower_components",
]);

const BINARY_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".mp4",
  ".webm",
  ".mp3",
  ".wav",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".tgz",
  ".7z",
  ".rar",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".wasm",
  ".sqlite",
  ".db",
  ".parquet",
  ".lockb",
  ".class",
  ".o",
  ".a",
  ".pyc",
  ".pyo",
]);

const SEMANTIC_SOURCE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

const STRUCTURAL_EXT = new Set([
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".xml",
  ".lock",
]);

const TEXTUAL_EXT = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".rst",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".htm",
  ".svg",
  ".graphql",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".rb",
  ".php",
  ".cs",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
]);

const PROTECTED_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
]);

const LFS_POINTER_RE =
  /^version https:\/\/git-lfs\.github\.com\/spec\/v1\r?\noid sha256:[a-f0-9]{64}\r?\nsize \d+\r?\n?$/i;

function pathHasSegment(rel: string, names: Set<string>): boolean {
  return rel.split("/").some((seg) => names.has(seg));
}

export function detectGeneratedPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const basename = path.posix.basename(normalized);
  return (
    pathHasSegment(normalized, GENERATED_DIR_NAMES) ||
    /\.(min|bundle|generated)\.(js|css|map)$/i.test(basename) ||
    basename.endsWith(".d.ts.map") ||
    /\.generated\./i.test(basename)
  );
}

export function detectVendoredPath(filePath: string): boolean {
  return pathHasSegment(filePath.replace(/\\/g, "/"), VENDOR_DIR_NAMES);
}

export function detectBinaryExt(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const basename = path.posix.basename(normalized);
  const ext = path.posix.extname(basename).toLowerCase();
  return BINARY_EXT.has(ext) || basename.endsWith(".lockb");
}

/** True when `text` is a Git LFS pointer file body. */
export function detectLfsPointerContent(text: string): boolean {
  const trimmed = text.replace(/^\uFEFF/, "");
  if (trimmed.length > 1024) return false;
  if (!trimmed.startsWith("version https://git-lfs.github.com/spec/v1")) return false;
  return LFS_POINTER_RE.test(trimmed) || (
    /^version https:\/\/git-lfs\.github\.com\/spec\/v1$/m.test(trimmed) &&
    /^oid sha256:[a-f0-9]{64}$/m.test(trimmed) &&
    /^size \d+$/m.test(trimmed)
  );
}

export function detectSymlinkMode(mode: string): boolean {
  return mode === "120000" || mode === "0120000";
}

export function detectGitlinkMode(mode: string): boolean {
  return mode === "160000" || mode === "0160000";
}

export function detectProtectedPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const basename = path.posix.basename(normalized);
  if (PROTECTED_BASENAMES.has(basename)) return true;
  if (/(^|\/)\.env(\.|$)/.test(normalized)) return true;
  if (/next\.config\.(js|mjs|ts|cjs)$/.test(basename)) return true;
  if (/^tsconfig(\..*)?\.json$/.test(basename)) return true;
  return false;
}

export interface PlanAnalyzersOptions {
  mode?: string;
  generated?: boolean;
  vendored?: boolean;
  binary?: boolean;
  lfsPointer?: boolean;
  symlink?: boolean;
  submodule?: boolean;
  protected?: boolean;
}

/**
 * Ordered analyzer layers for a path (primary first, then fallbacks).
 * Phase 1 never silently skips — every path gets at least metadata.
 */
export function planAnalyzersForPath(
  filePath: string,
  opts: PlanAnalyzersOptions = {}
): AnalyzerLayer[] {
  const normalized = filePath.replace(/\\/g, "/");
  const generated = opts.generated ?? detectGeneratedPath(normalized);
  const vendored = opts.vendored ?? detectVendoredPath(normalized);
  const binary = opts.binary ?? detectBinaryExt(normalized);
  const symlink = opts.symlink ?? (opts.mode ? detectSymlinkMode(opts.mode) : false);
  const submodule = opts.submodule ?? (opts.mode ? detectGitlinkMode(opts.mode) : false);
  const lfsPointer = opts.lfsPointer === true;

  if (submodule || symlink || lfsPointer || generated || vendored || binary) {
    return ["metadata"];
  }

  const ext = path.posix.extname(path.posix.basename(normalized)).toLowerCase();
  if (SEMANTIC_SOURCE_EXT.has(ext)) {
    return ["semantic", "structural", "textual", "metadata"];
  }
  if (STRUCTURAL_EXT.has(ext) || isManifestBasename(path.posix.basename(normalized))) {
    return ["structural", "textual", "metadata"];
  }
  if (TEXTUAL_EXT.has(ext)) {
    return ["textual", "metadata"];
  }
  return ["metadata"];
}

export function analyzerPlanFromLayers(layers: AnalyzerLayer[]): AnalyzerPlan {
  const primaryLayer = layers[0] ?? "metadata";
  const fallbackLayers = layers.slice(1);
  return fallbackLayers.length > 0
    ? { primaryLayer, fallbackLayers }
    : { primaryLayer };
}

function isManifestBasename(basename: string): boolean {
  return (
    basename === "package.json" ||
    basename === "pyproject.toml" ||
    basename === "go.mod" ||
    basename === "Cargo.toml" ||
    basename === "composer.json" ||
    basename === "Gemfile" ||
    basename === "pom.xml" ||
    basename === "build.gradle" ||
    basename === "build.gradle.kts" ||
    basename.endsWith(".config.js") ||
    basename.endsWith(".config.ts") ||
    basename.endsWith(".config.mjs")
  );
}

export interface ClassifyTrackedPathInput {
  path: string;
  mode?: string;
  objectType?: "blob" | "tree" | "commit";
  byteSize?: number;
  /** Optional first bytes / text for LFS pointer detection. */
  contentText?: string;
  protected?: boolean;
}

export interface ClassifyTrackedPathResult {
  outcome: TerminalCoverageOutcome;
  reason: string;
  matchingRule: string;
  analyzerLayers: AnalyzerLayer[];
  analyzerPlan: AnalyzerPlan;
  generated: boolean;
  vendored: boolean;
  binary: boolean;
  symlink: boolean;
  submodule: boolean;
  lfsPointer: boolean;
  protected: boolean;
}

/**
 * Propose a terminal coverage outcome from path/metadata before analyzers run.
 * Final outcome is assigned after the analyzer fallback chain completes.
 */
export function classifyTrackedPath(
  input: ClassifyTrackedPathInput
): ClassifyTrackedPathResult {
  const pathExact = normalizeRepoRelativePath(input.path);
  const mode = input.mode ?? "100644";
  const symlink = detectSymlinkMode(mode);
  const submodule =
    detectGitlinkMode(mode) || input.objectType === "commit";
  const generated = detectGeneratedPath(pathExact);
  const vendored = detectVendoredPath(pathExact);
  const binary = detectBinaryExt(pathExact);
  const lfsPointer =
    typeof input.contentText === "string"
      ? detectLfsPointerContent(input.contentText)
      : false;
  const protectedPath =
    input.protected ?? detectProtectedPath(pathExact);

  const analyzerLayers = planAnalyzersForPath(pathExact, {
    mode,
    generated,
    vendored,
    binary,
    lfsPointer,
    symlink,
    submodule,
    protected: protectedPath,
  });
  const analyzerPlan = analyzerPlanFromLayers(analyzerLayers);

  if (submodule) {
    return {
      outcome: "METADATA_ANALYZED",
      reason: "Git submodule gitlink — enumerated as metadata only.",
      matchingRule: "gitlink_mode_160000",
      analyzerLayers,
      analyzerPlan,
      generated,
      vendored,
      binary,
      symlink,
      submodule,
      lfsPointer,
      protected: protectedPath,
    };
  }
  if (symlink) {
    return {
      outcome: "METADATA_ANALYZED",
      reason: "Symlink — represented without following the target.",
      matchingRule: "symlink_mode_120000",
      analyzerLayers,
      analyzerPlan,
      generated,
      vendored,
      binary,
      symlink,
      submodule,
      lfsPointer,
      protected: protectedPath,
    };
  }
  if (lfsPointer) {
    return {
      outcome: "BINARY_INSPECTED",
      reason: "Git LFS pointer content detected.",
      matchingRule: "lfs_pointer_content",
      analyzerLayers,
      analyzerPlan,
      generated,
      vendored,
      binary,
      symlink,
      submodule,
      lfsPointer,
      protected: protectedPath,
    };
  }
  if (generated) {
    return {
      outcome: "GENERATED_CLASSIFIED",
      reason: "Generated or build-output path — classified without semantic analysis.",
      matchingRule: "generated_path_rule",
      analyzerLayers,
      analyzerPlan,
      generated,
      vendored,
      binary,
      symlink,
      submodule,
      lfsPointer,
      protected: protectedPath,
    };
  }
  if (vendored) {
    return {
      outcome: "VENDORED_CLASSIFIED",
      reason: "Vendored third-party path — classified without first-party semantic analysis.",
      matchingRule: "vendored_path_rule",
      analyzerLayers,
      analyzerPlan,
      generated,
      vendored,
      binary,
      symlink,
      submodule,
      lfsPointer,
      protected: protectedPath,
    };
  }
  if (binary) {
    return {
      outcome: "BINARY_INSPECTED",
      reason: "Binary or media extension — inspected via metadata/extension only.",
      matchingRule: "binary_ext_rule",
      analyzerLayers,
      analyzerPlan,
      generated,
      vendored,
      binary,
      symlink,
      submodule,
      lfsPointer,
      protected: protectedPath,
    };
  }
  if (protectedPath) {
    return {
      outcome: "PROTECTED_BY_POLICY",
      reason: "Protected path — modification blocked by policy; coverage still accounted.",
      matchingRule: "protected_path_policy",
      analyzerLayers,
      analyzerPlan,
      generated,
      vendored,
      binary,
      symlink,
      submodule,
      lfsPointer,
      protected: protectedPath,
    };
  }

  const ext = path.posix.extname(path.posix.basename(pathExact)).toLowerCase();
  if (SEMANTIC_SOURCE_EXT.has(ext)) {
    return {
      outcome: "SEMANTICALLY_ANALYZED",
      reason: "Proposed semantic analysis for supported source extension (pending analyzer chain).",
      matchingRule: "semantic_source_ext",
      analyzerLayers,
      analyzerPlan,
      generated,
      vendored,
      binary,
      symlink,
      submodule,
      lfsPointer,
      protected: protectedPath,
    };
  }
  if (STRUCTURAL_EXT.has(ext) || isManifestBasename(path.posix.basename(pathExact))) {
    return {
      outcome: "STRUCTURALLY_ANALYZED",
      reason: "Manifest or structured config — structural analysis proposed.",
      matchingRule: "structural_manifest_or_config",
      analyzerLayers,
      analyzerPlan,
      generated,
      vendored,
      binary,
      symlink,
      submodule,
      lfsPointer,
      protected: protectedPath,
    };
  }
  if (TEXTUAL_EXT.has(ext)) {
    return {
      outcome: "TEXTUALLY_ANALYZED",
      reason: "Textual non-JS/TS path — textual analysis proposed.",
      matchingRule: "textual_ext_rule",
      analyzerLayers,
      analyzerPlan,
      generated,
      vendored,
      binary,
      symlink,
      submodule,
      lfsPointer,
      protected: protectedPath,
    };
  }

  return {
    outcome: "METADATA_ANALYZED",
    reason: "No higher analyzer layer applicable — metadata classification.",
    matchingRule: "metadata_fallback",
    analyzerLayers,
    analyzerPlan,
    generated,
    vendored,
    binary,
    symlink,
    submodule,
    lfsPointer,
    protected: protectedPath,
  };
}
