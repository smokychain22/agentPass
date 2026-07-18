import path from "node:path";
import type {
  RepositoryTopologyDiscovery,
  RepositoryTopologyManifestEntry,
} from "./types";
import { normalizeRepoRelativePath } from "./path-normalize";

interface ManifestRule {
  kind: string;
  match: (basename: string, relPath: string) => boolean;
  packageManager?: string;
  framework?: string;
  marksProjectRoot?: boolean;
}

const MANIFEST_RULES: ManifestRule[] = [
  {
    kind: "package_json",
    match: (b) => b === "package.json",
    packageManager: "npm",
    marksProjectRoot: true,
  },
  {
    kind: "package_lock",
    match: (b) => b === "package-lock.json",
    packageManager: "npm",
  },
  {
    kind: "pnpm_lock",
    match: (b) => b === "pnpm-lock.yaml",
    packageManager: "pnpm",
  },
  {
    kind: "yarn_lock",
    match: (b) => b === "yarn.lock",
    packageManager: "yarn",
  },
  {
    kind: "bun_lock",
    match: (b) => b === "bun.lock" || b === "bun.lockb",
    packageManager: "bun",
  },
  {
    kind: "pnpm_workspace",
    match: (b) => b === "pnpm-workspace.yaml",
    packageManager: "pnpm",
  },
  {
    kind: "lerna",
    match: (b) => b === "lerna.json",
    packageManager: "npm",
  },
  {
    kind: "turbo",
    match: (b) => b === "turbo.json",
  },
  {
    kind: "nx",
    match: (b) => b === "nx.json",
  },
  {
    kind: "pyproject",
    match: (b) => b === "pyproject.toml",
    packageManager: "pip",
    marksProjectRoot: true,
  },
  {
    kind: "requirements_txt",
    match: (b) => b === "requirements.txt" || /^requirements[-_.].*\.txt$/i.test(b),
    packageManager: "pip",
  },
  {
    kind: "pipfile",
    match: (b) => b === "Pipfile" || b === "Pipfile.lock",
    packageManager: "pipenv",
    marksProjectRoot: true,
  },
  {
    kind: "poetry_lock",
    match: (b) => b === "poetry.lock",
    packageManager: "poetry",
  },
  {
    kind: "go_mod",
    match: (b) => b === "go.mod",
    packageManager: "go",
    marksProjectRoot: true,
  },
  {
    kind: "go_sum",
    match: (b) => b === "go.sum",
    packageManager: "go",
  },
  {
    kind: "cargo_toml",
    match: (b) => b === "Cargo.toml",
    packageManager: "cargo",
    marksProjectRoot: true,
  },
  {
    kind: "cargo_lock",
    match: (b) => b === "Cargo.lock",
    packageManager: "cargo",
  },
  {
    kind: "composer_json",
    match: (b) => b === "composer.json",
    packageManager: "composer",
    marksProjectRoot: true,
  },
  {
    kind: "composer_lock",
    match: (b) => b === "composer.lock",
    packageManager: "composer",
  },
  {
    kind: "gemfile",
    match: (b) => b === "Gemfile" || b === "Gemfile.lock",
    packageManager: "bundler",
    marksProjectRoot: true,
  },
  {
    kind: "pom_xml",
    match: (b) => b === "pom.xml",
    packageManager: "maven",
    marksProjectRoot: true,
  },
  {
    kind: "build_gradle",
    match: (b) => b === "build.gradle" || b === "build.gradle.kts",
    packageManager: "gradle",
    marksProjectRoot: true,
  },
  {
    kind: "mix_exs",
    match: (b) => b === "mix.exs",
    packageManager: "mix",
    marksProjectRoot: true,
  },
  {
    kind: "tsconfig",
    match: (b) => /^tsconfig(\..*)?\.json$/.test(b),
  },
  {
    kind: "next_config",
    match: (b) => /^next\.config\.(js|mjs|ts|cjs)$/.test(b),
    framework: "nextjs",
  },
  {
    kind: "vite_config",
    match: (b) => /^vite\.config\.(js|ts|mjs|cjs)$/.test(b),
    framework: "vite",
  },
  {
    kind: "vercel_json",
    match: (b) => b === "vercel.json",
    framework: "vercel",
  },
  {
    kind: "dockerfile",
    match: (b) => b === "Dockerfile" || /^Dockerfile\./i.test(b),
  },
  {
    kind: "docker_compose",
    match: (b) =>
      b === "docker-compose.yml" ||
      b === "docker-compose.yaml" ||
      b === "compose.yml" ||
      b === "compose.yaml",
  },
  {
    kind: "gitmodules",
    match: (b) => b === ".gitmodules",
  },
  {
    kind: "gitattributes",
    match: (b) => b === ".gitattributes",
  },
];

function projectRootFor(relPath: string): string {
  const dir = path.posix.dirname(relPath);
  return dir === "." ? "." : dir;
}

/**
 * Discover repository topology signals from inventoried path strings.
 * Phase 1: manifests (package.json, lockfiles, pyproject, go.mod, Cargo.toml, …).
 */
export function discoverRepositoryTopology(
  inventoryPaths: string[]
): RepositoryTopologyDiscovery {
  const manifests: RepositoryTopologyManifestEntry[] = [];
  const projectRoots = new Set<string>();
  const packageManagers = new Set<string>();
  const frameworks = new Set<string>();
  const submodulePaths: string[] = [];
  const lfsPointerPaths: string[] = [];

  for (const raw of inventoryPaths) {
    let pathExact: string;
    try {
      pathExact = normalizeRepoRelativePath(raw);
    } catch {
      continue;
    }
    const basename = path.posix.basename(pathExact);

    for (const rule of MANIFEST_RULES) {
      if (!rule.match(basename, pathExact)) continue;
      manifests.push({
        pathExact,
        pathNormalized: pathExact,
        kind: rule.kind,
        ...(rule.framework ? { framework: rule.framework } : {}),
        ...(rule.packageManager ? { packageManager: rule.packageManager } : {}),
      });
      if (rule.packageManager) packageManagers.add(rule.packageManager);
      if (rule.framework) frameworks.add(rule.framework);
      if (rule.marksProjectRoot) {
        projectRoots.add(projectRootFor(pathExact));
      }
      break;
    }
  }

  // Heuristic: package.json presence implies npm/node framework unless already set.
  if (manifests.some((m) => m.kind === "package_json") && !frameworks.has("nextjs")) {
    if (manifests.some((m) => m.kind === "next_config")) {
      frameworks.add("nextjs");
    } else if (manifests.some((m) => m.kind === "vite_config")) {
      frameworks.add("vite");
    } else {
      frameworks.add("node");
    }
  }

  return {
    manifests,
    projectRoots: [...projectRoots].sort(),
    packageManagers: [...packageManagers].sort(),
    frameworks: [...frameworks].sort(),
    submodulePaths,
    lfsPointerPaths,
  };
}
