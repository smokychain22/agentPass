/**
 * Machine-readable repository support contract for public marketplace buyers.
 * RepoDiet does not claim universal language support.
 */

export type SupportClass =
  | "supported"
  | "partially_supported"
  | "unsupported"
  | "generated"
  | "binary"
  | "vendored"
  | "git_lfs"
  | "submodule";

/** Honest analysis depth — never equate inventory with semantic understanding. */
export type AnalysisLevel =
  | "SEMANTICALLY_ANALYZED"
  | "SYNTAX_ANALYZED"
  | "TEXTUALLY_ANALYZED"
  | "METADATA_ANALYZED"
  | "GENERATED_CLASSIFIED"
  | "VENDORED_CLASSIFIED"
  | "BINARY_INSPECTED"
  | "SYMLINK_REPRESENTED"
  | "SUBMODULE_REPRESENTED"
  | "UNAVAILABLE_WITH_REASON";

export interface LanguageSupportEntry {
  id: string;
  label: string;
  class: SupportClass;
  /** Maximum analysis depth currently offered for this ecosystem. */
  analysisLevel: AnalysisLevel;
  detection: boolean;
  semanticAnalysis: boolean;
  validation: boolean;
  automaticFix: boolean;
  notes?: string;
}

export interface FrameworkSupportEntry {
  id: string;
  label: string;
  class: SupportClass;
  packageManagers?: string[];
}

export interface RepositorySupportMatrix {
  version: string;
  supportedLanguages: string[];
  languages: LanguageSupportEntry[];
  frameworks: FrameworkSupportEntry[];
  packageManagers: Array<{ id: string; class: SupportClass; validation: boolean }>;
  acquisition: {
    githubArchiveZip: SupportClass;
    gitCloneViaApp: SupportClass;
    gitLfs: SupportClass;
    submodules: SupportClass;
  };
  claims: {
    universalLanguageSupport: false;
    semanticAnalysisOfBinaries: false;
    semanticAnalysisOfGeneratedBundles: false;
    trackedPathAccountingPhase1: true;
    wslIsExecutionEnvironmentNotLanguage: true;
  };
}

function lang(
  partial: LanguageSupportEntry
): LanguageSupportEntry {
  return partial;
}

export const REPOSITORY_SUPPORT_MATRIX: RepositorySupportMatrix = {
  version: "repodiet-support-v2",
  supportedLanguages: ["JavaScript", "TypeScript"],
  languages: [
    lang({
      id: "javascript",
      label: "JavaScript",
      class: "supported",
      analysisLevel: "SEMANTICALLY_ANALYZED",
      detection: true,
      semanticAnalysis: true,
      validation: true,
      automaticFix: true,
    }),
    lang({
      id: "typescript",
      label: "TypeScript",
      class: "supported",
      analysisLevel: "SEMANTICALLY_ANALYZED",
      detection: true,
      semanticAnalysis: true,
      validation: true,
      automaticFix: true,
    }),
    lang({
      id: "jsx",
      label: "JSX / React",
      class: "supported",
      analysisLevel: "SEMANTICALLY_ANALYZED",
      detection: true,
      semanticAnalysis: true,
      validation: true,
      automaticFix: true,
    }),
    lang({
      id: "tsx",
      label: "TSX / React",
      class: "supported",
      analysisLevel: "SEMANTICALLY_ANALYZED",
      detection: true,
      semanticAnalysis: true,
      validation: true,
      automaticFix: true,
    }),
    lang({
      id: "nodejs",
      label: "Node.js",
      class: "supported",
      analysisLevel: "SEMANTICALLY_ANALYZED",
      detection: true,
      semanticAnalysis: true,
      validation: true,
      automaticFix: true,
      notes: "Runtime ecosystem for JS/TS — not a separate language.",
    }),
    lang({
      id: "json",
      label: "JSON",
      class: "partially_supported",
      analysisLevel: "SYNTAX_ANALYZED",
      detection: true,
      semanticAnalysis: false,
      validation: true,
      automaticFix: false,
      notes: "Manifest/config syntax checks only.",
    }),
    lang({
      id: "yaml",
      label: "YAML",
      class: "partially_supported",
      analysisLevel: "SYNTAX_ANALYZED",
      detection: true,
      semanticAnalysis: false,
      validation: false,
      automaticFix: false,
    }),
    lang({
      id: "markdown",
      label: "Markdown",
      class: "partially_supported",
      analysisLevel: "TEXTUALLY_ANALYZED",
      detection: true,
      semanticAnalysis: false,
      validation: false,
      automaticFix: false,
    }),
    lang({
      id: "shell",
      label: "Shell",
      class: "partially_supported",
      analysisLevel: "TEXTUALLY_ANALYZED",
      detection: true,
      semanticAnalysis: false,
      validation: false,
      automaticFix: false,
      notes: "Inventoried; never executed from repository text.",
    }),
    lang({
      id: "powershell",
      label: "PowerShell",
      class: "partially_supported",
      analysisLevel: "TEXTUALLY_ANALYZED",
      detection: true,
      semanticAnalysis: false,
      validation: false,
      automaticFix: false,
    }),
    lang({
      id: "docker",
      label: "Docker",
      class: "partially_supported",
      analysisLevel: "METADATA_ANALYZED",
      detection: true,
      semanticAnalysis: false,
      validation: false,
      automaticFix: false,
    }),
    lang({
      id: "terraform",
      label: "Terraform",
      class: "partially_supported",
      analysisLevel: "TEXTUALLY_ANALYZED",
      detection: true,
      semanticAnalysis: false,
      validation: false,
      automaticFix: false,
    }),
    lang({
      id: "sql",
      label: "SQL",
      class: "partially_supported",
      analysisLevel: "TEXTUALLY_ANALYZED",
      detection: true,
      semanticAnalysis: false,
      validation: false,
      automaticFix: false,
    }),
    lang({
      id: "python",
      label: "Python",
      class: "unsupported",
      analysisLevel: "TEXTUALLY_ANALYZED",
      detection: true,
      semanticAnalysis: false,
      validation: false,
      automaticFix: false,
      notes: "Detected and inventoried; no semantic analyzer or auto-fix.",
    }),
    lang({
      id: "go",
      label: "Go",
      class: "unsupported",
      analysisLevel: "TEXTUALLY_ANALYZED",
      detection: true,
      semanticAnalysis: false,
      validation: false,
      automaticFix: false,
    }),
    lang({
      id: "rust",
      label: "Rust",
      class: "unsupported",
      analysisLevel: "TEXTUALLY_ANALYZED",
      detection: true,
      semanticAnalysis: false,
      validation: false,
      automaticFix: false,
    }),
    lang({
      id: "java",
      label: "Java",
      class: "unsupported",
      analysisLevel: "TEXTUALLY_ANALYZED",
      detection: true,
      semanticAnalysis: false,
      validation: false,
      automaticFix: false,
    }),
    lang({
      id: "kotlin",
      label: "Kotlin",
      class: "unsupported",
      analysisLevel: "TEXTUALLY_ANALYZED",
      detection: true,
      semanticAnalysis: false,
      validation: false,
      automaticFix: false,
    }),
    lang({
      id: "csharp",
      label: "C#",
      class: "unsupported",
      analysisLevel: "TEXTUALLY_ANALYZED",
      detection: true,
      semanticAnalysis: false,
      validation: false,
      automaticFix: false,
    }),
    lang({
      id: "php",
      label: "PHP",
      class: "unsupported",
      analysisLevel: "TEXTUALLY_ANALYZED",
      detection: true,
      semanticAnalysis: false,
      validation: false,
      automaticFix: false,
    }),
    lang({
      id: "ruby",
      label: "Ruby",
      class: "unsupported",
      analysisLevel: "TEXTUALLY_ANALYZED",
      detection: true,
      semanticAnalysis: false,
      validation: false,
      automaticFix: false,
    }),
    lang({
      id: "c",
      label: "C",
      class: "unsupported",
      analysisLevel: "TEXTUALLY_ANALYZED",
      detection: true,
      semanticAnalysis: false,
      validation: false,
      automaticFix: false,
    }),
    lang({
      id: "cpp",
      label: "C++",
      class: "unsupported",
      analysisLevel: "TEXTUALLY_ANALYZED",
      detection: true,
      semanticAnalysis: false,
      validation: false,
      automaticFix: false,
    }),
    lang({
      id: "swift",
      label: "Swift",
      class: "unsupported",
      analysisLevel: "TEXTUALLY_ANALYZED",
      detection: true,
      semanticAnalysis: false,
      validation: false,
      automaticFix: false,
    }),
    lang({
      id: "solidity",
      label: "Solidity",
      class: "unsupported",
      analysisLevel: "TEXTUALLY_ANALYZED",
      detection: true,
      semanticAnalysis: false,
      validation: false,
      automaticFix: false,
    }),
    lang({
      id: "wsl",
      label: "WSL",
      class: "unsupported",
      analysisLevel: "UNAVAILABLE_WITH_REASON",
      detection: false,
      semanticAnalysis: false,
      validation: false,
      automaticFix: false,
      notes: "WSL is an execution environment, not a programming language.",
    }),
  ],
  frameworks: [
    { id: "nextjs", label: "Next.js", class: "supported", packageManagers: ["npm", "pnpm", "yarn", "bun"] },
    { id: "react", label: "React", class: "supported", packageManagers: ["npm", "pnpm", "yarn", "bun"] },
    { id: "node", label: "Node.js", class: "supported", packageManagers: ["npm", "pnpm", "yarn", "bun"] },
    { id: "vite", label: "Vite", class: "partially_supported" },
    { id: "monorepo_npm", label: "npm/pnpm/yarn workspaces", class: "partially_supported" },
  ],
  packageManagers: [
    { id: "npm", class: "supported", validation: true },
    { id: "pnpm", class: "supported", validation: true },
    { id: "yarn", class: "supported", validation: true },
    { id: "bun", class: "partially_supported", validation: false },
  ],
  acquisition: {
    githubArchiveZip: "supported",
    gitCloneViaApp: "partially_supported",
    gitLfs: "unsupported",
    submodules: "partially_supported",
  },
  claims: {
    universalLanguageSupport: false,
    semanticAnalysisOfBinaries: false,
    semanticAnalysisOfGeneratedBundles: false,
    trackedPathAccountingPhase1: true,
    wslIsExecutionEnvironmentNotLanguage: true,
  },
};

export interface UnsupportedRepositoryResponse {
  status: "UNSUPPORTED";
  reason: string;
  supportedLanguages: string[];
  supportMatrixVersion: string;
  retryable: false;
  paymentRequired: false;
  requiredAction: "CHOOSE_SUPPORTED_REPOSITORY";
}

export function unsupportedRepositoryResponse(reason: string): UnsupportedRepositoryResponse {
  return {
    status: "UNSUPPORTED",
    reason,
    supportedLanguages: [...REPOSITORY_SUPPORT_MATRIX.supportedLanguages],
    supportMatrixVersion: REPOSITORY_SUPPORT_MATRIX.version,
    retryable: false,
    paymentRequired: false,
    requiredAction: "CHOOSE_SUPPORTED_REPOSITORY",
  };
}

export function classifyPrimaryLanguage(extCounts: Record<string, number>): {
  primary: string;
  supported: boolean;
} {
  const jsTs =
    (extCounts[".ts"] ?? 0) +
    (extCounts[".tsx"] ?? 0) +
    (extCounts[".js"] ?? 0) +
    (extCounts[".jsx"] ?? 0) +
    (extCounts[".mjs"] ?? 0) +
    (extCounts[".cjs"] ?? 0);
  const otherCode =
    (extCounts[".py"] ?? 0) +
    (extCounts[".go"] ?? 0) +
    (extCounts[".rs"] ?? 0) +
    (extCounts[".java"] ?? 0) +
    (extCounts[".kt"] ?? 0) +
    (extCounts[".cs"] ?? 0) +
    (extCounts[".rb"] ?? 0) +
    (extCounts[".php"] ?? 0) +
    (extCounts[".sol"] ?? 0) +
    (extCounts[".swift"] ?? 0) +
    (extCounts[".c"] ?? 0) +
    (extCounts[".cpp"] ?? 0) +
    (extCounts[".cc"] ?? 0);

  if (jsTs === 0 && otherCode > 0) {
    return { primary: "non-javascript", supported: false };
  }
  if (jsTs === 0) {
    return { primary: "unknown", supported: false };
  }
  return { primary: "javascript_typescript", supported: true };
}
