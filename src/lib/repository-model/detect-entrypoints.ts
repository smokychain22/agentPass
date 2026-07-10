import path from "node:path";
import type { EntrypointRole, FileContext, FrameworkKind, RuntimeTarget } from "./types";
import type { ProjectRoot } from "./types";

const ROUTE_PATTERNS: Array<{ pattern: RegExp; role: EntrypointRole }> = [
  { pattern: /(^|\/)app\/api\/.*\/route\.(tsx?|jsx?)$/, role: "app_router_route" },
  { pattern: /(^|\/)app\/.*\/page\.(tsx?|jsx?)$/, role: "app_router_page" },
  { pattern: /(^|\/)app\/.*\/layout\.(tsx?|jsx?)$/, role: "app_router_layout" },
  { pattern: /(^|\/)pages\/.*\.(tsx?|jsx?)$/, role: "pages_router" },
  { pattern: /(^|\/)middleware\.(ts|js)$/, role: "middleware" },
  { pattern: /next\.config\.(js|mjs|ts|cjs)$/, role: "config" },
  { pattern: /(^|\/)(vitest|jest)\.config\./, role: "test" },
  { pattern: /(^|\/).*\.(test|spec)\.(tsx?|jsx?)$/, role: "test" },
];

export function detectEntrypointRole(relPath: string): EntrypointRole {
  const normalized = relPath.replace(/\\/g, "/");
  for (const { pattern, role } of ROUTE_PATTERNS) {
    if (pattern.test(normalized)) return role;
  }
  return "library";
}

export function protectedRolesFor(role: EntrypointRole): string[] {
  switch (role) {
    case "app_router_route":
    case "api_route":
      return ["api_route"];
    case "middleware":
      return ["middleware"];
    case "app_router_page":
    case "app_router_layout":
    case "pages_router":
      return ["route_component"];
    case "config":
      return ["infrastructure"];
    default:
      return [];
  }
}

export function runtimeForFramework(framework: FrameworkKind, role: EntrypointRole): RuntimeTarget {
  if (role === "middleware") return "edge";
  if (role === "app_router_route" || role === "api_route") return "node";
  if (framework === "nextjs" && (role === "app_router_page" || role === "app_router_layout")) {
    return "mixed";
  }
  if (framework === "node") return "node";
  if (framework === "vite" || framework === "react") return "browser";
  return "unknown";
}

export function resolveFileContext(
  repositoryPath: string,
  projects: ProjectRoot[]
): FileContext {
  const normalized = repositoryPath.replace(/\\/g, "/");
  const project =
    [...projects]
      .sort((a, b) => b.projectRoot.length - a.projectRoot.length)
      .find((p) => normalized.startsWith(p.relativePath ? `${p.relativePath}/` : "") || normalized === p.relativePath) ??
    projects[0];

  const role = detectEntrypointRole(normalized);
  const framework = project?.framework ?? "unknown";

  return {
    repositoryPath: normalized,
    projectRoot: project?.relativePath ?? "",
    packageName: project?.packageName ?? "root",
    framework,
    runtimeTarget: runtimeForFramework(framework, role),
    entrypointRole: role,
    protectedRoles: protectedRolesFor(role),
  };
}

export function sameProjectBoundary(a: FileContext, b: FileContext): boolean {
  return a.projectRoot === b.projectRoot && a.packageName === b.packageName;
}

export function sameRuntimeBoundary(a: FileContext, b: FileContext): boolean {
  return a.runtimeTarget === b.runtimeTarget || a.runtimeTarget === "mixed" || b.runtimeTarget === "mixed";
}
