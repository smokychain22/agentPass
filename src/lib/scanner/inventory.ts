import fs from "node:fs/promises";
import path from "node:path";
import { isDoNotTouchPath } from "@/lib/findings/confidence-path-rules";

export type InventoryLanguage =
  | "typescript"
  | "javascript"
  | "json"
  | "markdown"
  | "css"
  | "html"
  | "yaml"
  | "shell"
  | "python"
  | "go"
  | "rust"
  | "other"
  | "unknown";

export type InventoryFileKind =
  | "supported_source"
  | "configuration"
  | "test"
  | "fixture"
  | "lockfile"
  | "documentation"
  | "asset"
  | "binary"
  | "generated"
  | "vendor"
  | "unsupported"
  | "protected";

export interface InventoryFileRecord {
  path: string;
  sizeBytes: number;
  extension: string;
  language: InventoryLanguage;
  kind: InventoryFileKind;
  generated: boolean;
  binary: boolean;
  vendored: boolean;
  protected: boolean;
  configuration: boolean;
  testOrFixture: boolean;
  routeCandidate: boolean;
  entryPointCandidate: boolean;
  exclusionReason?: string;
}

export interface InventoryExclusion {
  path: string;
  reason: string;
  kind: InventoryFileKind;
}

export type CoverageStatusContract =
  | "COMPLETE_FOR_SUPPORTED_SCOPE"
  | "PARTIAL"
  | "FAILED";

export interface RepositoryCoverageContract {
  totalFiles: number;
  supportedSourceFiles: number;
  analyzedSourceFiles: number;
  configurationFilesIndexed: number;
  testFilesIndexed: number;
  entryPointsDetected: number;
  generatedFilesExcluded: number;
  binaryFilesExcluded: number;
  vendorFilesExcluded: number;
  unsupportedFiles: number;
  protectedFiles: number;
  exclusions: InventoryExclusion[];
  coverageStatus: CoverageStatusContract;
  supportedLanguages: string[];
  claimsSemanticAnalysisOfAllFiles: false;
}

const SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  ".pnpm-store",
  ".yarn",
]);

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
]);

const VENDOR_DIR_NAMES = new Set(["vendor", "third_party", "third-party", "vendored"]);

const SUPPORTED_SOURCE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

const CONFIG_NAMES = new Set([
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "vite.config.ts",
  "vite.config.js",
  "webpack.config.js",
  "eslint.config.js",
  "eslint.config.mjs",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  "prettier.config.js",
  ".prettierrc",
  "tailwind.config.js",
  "tailwind.config.ts",
  "postcss.config.js",
  "postcss.config.mjs",
  "babel.config.js",
  "jest.config.js",
  "vitest.config.ts",
  "playwright.config.ts",
  "docker-compose.yml",
  "Dockerfile",
  "vercel.json",
  "turbo.json",
  "nx.json",
  "pnpm-workspace.yaml",
  "lerna.json",
]);

const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
]);

const BINARY_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp4",
  ".webm",
  ".mp3",
  ".wav",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".wasm",
  ".sqlite",
  ".db",
]);

const LANGUAGE_BY_EXT: Record<string, InventoryLanguage> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".mdx": "markdown",
  ".css": "css",
  ".scss": "css",
  ".sass": "css",
  ".less": "css",
  ".html": "html",
  ".htm": "html",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".sh": "shell",
  ".bash": "shell",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
};

function languageFor(ext: string, basename: string): InventoryLanguage {
  if (LANGUAGE_BY_EXT[ext]) return LANGUAGE_BY_EXT[ext];
  if (basename === "Dockerfile") return "shell";
  return ext ? "other" : "unknown";
}

function isTestOrFixturePath(rel: string): boolean {
  const lower = rel.toLowerCase();
  return (
    /(^|\/)(__tests__|__mocks__|fixtures?|testdata)(\/|$)/.test(lower) ||
    /\.(test|spec)\.(tsx?|jsx?|mjs|cjs)$/.test(lower) ||
    /(^|\/)tests?\//.test(lower)
  );
}

function isRouteCandidate(rel: string): boolean {
  const lower = rel.replace(/\\/g, "/");
  return (
    /(^|\/)app\/.*\/(page|layout|route|loading|error|not-found|template|default)\.(tsx?|jsx?)$/.test(
      lower
    ) ||
    /(^|\/)pages\/.+\.(tsx?|jsx?)$/.test(lower) ||
    /(^|\/)app\/api\/.+\/route\.(tsx?|jsx?)$/.test(lower)
  );
}

function isEntryPointCandidate(rel: string, basename: string): boolean {
  if (isRouteCandidate(rel)) return true;
  if (/^(middleware|instrumentation)\.(tsx?|jsx?|mjs|cjs)$/.test(basename)) return true;
  if (/(^|\/)(bin|scripts)\//.test(rel)) return true;
  if (/^index\.(tsx?|jsx?|mjs|cjs)$/.test(basename) && !rel.includes("/")) return true;
  return false;
}

function pathHasSegment(rel: string, names: Set<string>): boolean {
  return rel.split("/").some((seg) => names.has(seg));
}

export function classifyInventoryPath(
  rel: string,
  sizeBytes: number,
  options?: { treatAsDirSkip?: InventoryFileKind }
): InventoryFileRecord {
  const normalized = rel.replace(/\\/g, "/");
  const basename = path.posix.basename(normalized);
  const ext = path.posix.extname(basename).toLowerCase();
  const language = languageFor(ext, basename);
  const protectedPath = isDoNotTouchPath(normalized);
  const generated =
    pathHasSegment(normalized, GENERATED_DIR_NAMES) ||
    /\.(min|bundle|generated)\.(js|css)$/i.test(basename) ||
    basename.endsWith(".d.ts.map");
  const vendored = pathHasSegment(normalized, VENDOR_DIR_NAMES);
  const binary = BINARY_EXT.has(ext) || basename.endsWith(".lockb");
  const configuration =
    CONFIG_NAMES.has(basename) ||
    /^\.[a-z].*rc(\.|$)/i.test(basename) ||
    basename.endsWith(".config.js") ||
    basename.endsWith(".config.ts") ||
    basename.endsWith(".config.mjs");
  const lockfile = LOCKFILE_NAMES.has(basename);
  const testOrFixture = isTestOrFixturePath(normalized);
  const supportedSource = SUPPORTED_SOURCE_EXT.has(ext) && !generated && !vendored;

  let kind: InventoryFileKind = "unsupported";
  let exclusionReason: string | undefined;

  if (options?.treatAsDirSkip === "vendor") {
    kind = "vendor";
    exclusionReason = "Vendor or dependency directory skipped during inventory walk.";
  } else if (generated) {
    kind = "generated";
    exclusionReason = "Generated or build-output path — not semantically analyzed.";
  } else if (vendored) {
    kind = "vendor";
    exclusionReason = "Vendored third-party path — not treated as first-party source.";
  } else if (binary) {
    kind = "binary";
    exclusionReason = "Binary or media asset — not semantically analyzed.";
  } else if (lockfile) {
    kind = "lockfile";
  } else if (configuration) {
    kind = "configuration";
  } else if (testOrFixture) {
    kind = "test";
  } else if (supportedSource) {
    kind = protectedPath ? "protected" : "supported_source";
  } else if ([".md", ".mdx", ".txt"].includes(ext)) {
    kind = "documentation";
    exclusionReason = "Documentation — indexed but not JS/TS semantic analysis.";
  } else if ([".css", ".scss", ".sass", ".less", ".html"].includes(ext)) {
    kind = "asset";
    exclusionReason = "Style/markup asset — not JS/TS semantic analysis.";
  } else {
    kind = "unsupported";
    exclusionReason = `Unsupported language/extension (${ext || "none"}) for JS/TS analyzer scope.`;
  }

  if (protectedPath && kind === "supported_source") {
    kind = "protected";
  }

  return {
    path: normalized,
    sizeBytes,
    extension: ext || "(none)",
    language,
    kind,
    generated,
    binary,
    vendored,
    protected: protectedPath,
    configuration: configuration || lockfile,
    testOrFixture,
    routeCandidate: isRouteCandidate(normalized),
    entryPointCandidate: isEntryPointCandidate(normalized, basename),
    exclusionReason,
  };
}

export interface FullRepositoryInventory {
  files: InventoryFileRecord[];
  allRelativePaths: string[];
  topLevelFolders: string[];
  skippedDirectories: InventoryExclusion[];
  totalBytes: number;
}

export async function buildFullRepositoryInventory(rootDir: string): Promise<FullRepositoryInventory> {
  const files: InventoryFileRecord[] = [];
  const allRelativePaths: string[] = [];
  const skippedDirectories: InventoryExclusion[] = [];
  let totalBytes = 0;

  async function walk(current: string, relative: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name)) {
          skippedDirectories.push({
            path: rel,
            reason:
              entry.name === "node_modules"
                ? "Dependency tree skipped — counted as vendor exclusion boundary."
                : "VCS metadata directory skipped.",
            kind: "vendor",
          });
          continue;
        }
        if (GENERATED_DIR_NAMES.has(entry.name)) {
          skippedDirectories.push({
            path: rel,
            reason: "Generated/build directory skipped as a unit.",
            kind: "generated",
          });
          // Still record the directory as an excluded generated boundary, do not recurse.
          continue;
        }
        await walk(full, rel);
        continue;
      }

      if (!entry.isFile()) continue;

      let sizeBytes = 0;
      try {
        const stat = await fs.stat(full);
        sizeBytes = stat.size;
      } catch {
        sizeBytes = 0;
      }
      totalBytes += sizeBytes;
      allRelativePaths.push(rel);
      files.push(classifyInventoryPath(rel, sizeBytes));
    }
  }

  await walk(rootDir, "");

  const topLevelFolders: string[] = [];
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !SKIP_DIR_NAMES.has(entry.name)) {
        topLevelFolders.push(entry.name);
      }
    }
  } catch {
    /* empty */
  }

  return {
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    allRelativePaths,
    topLevelFolders: topLevelFolders.sort(),
    skippedDirectories,
    totalBytes,
  };
}

export function buildCoverageContract(input: {
  inventory: FullRepositoryInventory;
  analyzedSourceFiles: number;
  entryPointsDetected: number;
  commitSha?: string;
  analysisComplete: boolean;
}): RepositoryCoverageContract {
  const { inventory } = input;
  const supportedSourceFiles = inventory.files.filter((f) => f.kind === "supported_source").length;
  const configurationFilesIndexed = inventory.files.filter(
    (f) => f.kind === "configuration" || f.kind === "lockfile"
  ).length;
  const testFilesIndexed = inventory.files.filter((f) => f.kind === "test" || f.kind === "fixture").length;
  const generatedFilesExcluded =
    inventory.files.filter((f) => f.kind === "generated").length +
    inventory.skippedDirectories.filter((d) => d.kind === "generated").length;
  const binaryFilesExcluded = inventory.files.filter((f) => f.kind === "binary").length;
  const vendorFilesExcluded =
    inventory.files.filter((f) => f.kind === "vendor").length +
    inventory.skippedDirectories.filter((d) => d.kind === "vendor").length;
  const unsupportedFiles = inventory.files.filter(
    (f) => f.kind === "unsupported" || f.kind === "documentation" || f.kind === "asset"
  ).length;
  const protectedFiles = inventory.files.filter((f) => f.protected || f.kind === "protected").length;

  const exclusions: InventoryExclusion[] = [
    ...inventory.skippedDirectories,
    ...inventory.files
      .filter((f) => f.exclusionReason)
      .map((f) => ({
        path: f.path,
        reason: f.exclusionReason!,
        kind: f.kind,
      })),
  ];

  let coverageStatus: CoverageStatusContract = "COMPLETE_FOR_SUPPORTED_SCOPE";
  if (inventory.files.length === 0 || supportedSourceFiles === 0) {
    coverageStatus = "FAILED";
  } else if (
    !input.commitSha ||
    !input.analysisComplete ||
    input.analyzedSourceFiles < supportedSourceFiles
  ) {
    coverageStatus = "PARTIAL";
  }

  return {
    totalFiles: inventory.files.length,
    supportedSourceFiles,
    analyzedSourceFiles: Math.min(input.analyzedSourceFiles, supportedSourceFiles),
    configurationFilesIndexed,
    testFilesIndexed,
    entryPointsDetected: input.entryPointsDetected,
    generatedFilesExcluded,
    binaryFilesExcluded,
    vendorFilesExcluded,
    unsupportedFiles,
    protectedFiles,
    exclusions: exclusions.slice(0, 500),
    coverageStatus,
    supportedLanguages: ["javascript", "typescript"],
    claimsSemanticAnalysisOfAllFiles: false,
  };
}
