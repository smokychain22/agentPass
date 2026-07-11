import type { ProjectRoot, RepositoryModel } from "./types";

export type ProjectRootRole =
  | "primary"
  | "workspace"
  | "nested_copy"
  | "artifact"
  | "unknown";

export interface ClassifiedProjectRoot extends ProjectRoot {
  role: ProjectRootRole;
}

function depth(relativePath: string): number {
  if (!relativePath || relativePath === ".") return 0;
  return relativePath.split("/").filter(Boolean).length;
}

function looksLikeArtifactCopy(relativePath: string): boolean {
  return /^(artifacts?|dist|build|output|demo|sample|backup|archive)(\/|$)/i.test(relativePath);
}

export function classifyProjectRoots(model: RepositoryModel): ClassifiedProjectRoot[] {
  const sorted = [...model.projects].sort((a, b) => depth(a.relativePath) - depth(b.relativePath));
  const rootPkg = sorted.find((p) => !p.relativePath || p.relativePath === ".");
  const shallowNext = sorted.find((p) => p.framework === "nextjs");

  return sorted.map((project) => {
    let role: ProjectRootRole = "unknown";
    if (looksLikeArtifactCopy(project.relativePath)) {
      role = "artifact";
    } else if (project.workspaceMember) {
      role = "workspace";
    } else if (
      rootPkg &&
      project.relativePath &&
      project.relativePath !== rootPkg.relativePath &&
      project.framework === rootPkg.framework &&
      project.framework !== "unknown"
    ) {
      role = "nested_copy";
    } else if (
      project === rootPkg ||
      (!rootPkg && project === shallowNext) ||
      (project.relativePath === "" && project.framework === "nextjs")
    ) {
      role = "primary";
    }
    return { ...project, role };
  });
}

export function selectPrimaryProjectRoot(model: RepositoryModel): string {
  const classified = classifyProjectRoots(model);
  const primary = classified.find((p) => p.role === "primary");
  if (primary) return primary.relativePath || "";

  const shallow = [...classified].sort((a, b) => depth(a.relativePath) - depth(b.relativePath))[0];
  return shallow?.relativePath ?? "";
}

export function projectRootPrefixes(model: RepositoryModel): string[] {
  return model.projects
    .map((p) => p.relativePath)
    .filter((p) => p.length > 0)
    .sort((a, b) => b.length - a.length);
}

export function pathUnderProjectRoot(filePath: string, rootPrefix: string): boolean {
  if (!rootPrefix) return !filePath.includes("/") || !filePath.startsWith("agora-forge/");
  const normalized = filePath.replace(/\\/g, "/");
  return normalized === rootPrefix || normalized.startsWith(`${rootPrefix}/`);
}
