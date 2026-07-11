export type FrameworkKind =
  | "nextjs"
  | "react"
  | "vite"
  | "node"
  | "unknown";

export type RuntimeTarget = "browser" | "node" | "edge" | "mixed" | "unknown";

export type EntrypointRole =
  | "app_router_page"
  | "app_router_layout"
  | "app_router_route"
  | "pages_router"
  | "api_route"
  | "middleware"
  | "config"
  | "test"
  | "script"
  | "library"
  | "unknown";

export interface ProjectRoot {
  projectRoot: string;
  packageName: string;
  relativePath: string;
  framework: FrameworkKind;
  runtimeTarget: RuntimeTarget;
  workspaceMember?: boolean;
}

export interface FileContext {
  repositoryPath: string;
  projectRoot: string;
  packageName: string;
  framework: FrameworkKind;
  runtimeTarget: RuntimeTarget;
  entrypointRole: EntrypointRole;
  protectedRoles: string[];
}

export interface RepositoryModel {
  repositoryRoot: string;
  projects: ProjectRoot[];
  workspaces: string[];
  monorepoTool?: "turbo" | "nx" | "pnpm" | "yarn" | "npm" | null;
  fileIndex: Record<string, FileContext>;
  detectedAt: string;
}

export interface DuplicateSemantics {
  syntacticSimilarity: number;
  structuralSimilarity: number;
  behavioralSimilarity: number;
  sameProject: boolean;
  sameRuntime: boolean;
  sideEffectDifferences: boolean;
  routeDifferences: boolean;
  classification:
    | "exact_clone"
    | "structural_clone"
    | "visual_clone"
    | "functional_clone"
    | "intentional_parallel"
    | "shared_abstraction_candidate";
  recommendation: "auto_fix_forbidden" | "review_first" | "safe_candidate";
  rationale: string;
}
