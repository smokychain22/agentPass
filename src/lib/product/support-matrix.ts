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

export interface LanguageSupportEntry {
  id: string;
  label: string;
  class: SupportClass;
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
  packageManagers: Array<{ id: string; class: SupportClass }>;
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
  };
}

export const REPOSITORY_SUPPORT_MATRIX: RepositorySupportMatrix = {
  version: "repodiet-support-v1",
  supportedLanguages: ["JavaScript", "TypeScript"],
  languages: [
    { id: "javascript", label: "JavaScript", class: "supported" },
    { id: "typescript", label: "TypeScript", class: "supported" },
    { id: "jsx", label: "JSX", class: "supported" },
    { id: "tsx", label: "TSX", class: "supported" },
    { id: "json", label: "JSON configs/manifests", class: "partially_supported", notes: "Indexed; not semantically analyzed as application logic." },
    { id: "css", label: "CSS", class: "unsupported", notes: "Inventoried as asset; excluded from JS/TS analysis." },
    { id: "python", label: "Python", class: "unsupported" },
    { id: "go", label: "Go", class: "unsupported" },
    { id: "rust", label: "Rust", class: "unsupported" },
    { id: "solidity", label: "Solidity", class: "unsupported" },
    { id: "sql", label: "SQL", class: "unsupported" },
  ],
  frameworks: [
    { id: "nextjs", label: "Next.js", class: "supported", packageManagers: ["npm", "pnpm", "yarn"] },
    { id: "react", label: "React", class: "supported", packageManagers: ["npm", "pnpm", "yarn"] },
    { id: "node", label: "Node.js", class: "supported", packageManagers: ["npm", "pnpm", "yarn"] },
    { id: "vite", label: "Vite", class: "partially_supported" },
    { id: "monorepo_npm", label: "npm/pnpm/yarn workspaces", class: "partially_supported" },
  ],
  packageManagers: [
    { id: "npm", class: "supported" },
    { id: "pnpm", class: "supported" },
    { id: "yarn", class: "supported" },
    { id: "bun", class: "partially_supported" },
  ],
  acquisition: {
    githubArchiveZip: "supported",
    gitCloneViaApp: "partially_supported",
    gitLfs: "unsupported",
    submodules: "unsupported",
  },
  claims: {
    universalLanguageSupport: false,
    semanticAnalysisOfBinaries: false,
    semanticAnalysisOfGeneratedBundles: false,
    /** Phase 1: accounting coverage ≠ semantic support. */
    trackedPathAccountingPhase1: true,
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
    (extCounts[".rb"] ?? 0) +
    (extCounts[".php"] ?? 0) +
    (extCounts[".sol"] ?? 0);

  if (jsTs === 0 && otherCode > 0) {
    return { primary: "non-javascript", supported: false };
  }
  if (jsTs === 0) {
    return { primary: "unknown", supported: false };
  }
  return { primary: "javascript_typescript", supported: true };
}
