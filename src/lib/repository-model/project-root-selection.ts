import type { RepositoryModel } from "./types";
import {
  classifyProjectRoots,
  type ClassifiedProjectRoot,
  type ProjectRootRole,
} from "./primary-root";

const NON_APPLICATION_ROLES = new Set<ProjectRootRole>(["nested_copy", "artifact"]);

export interface SelectableApplicationRoot {
  projectRoot: string;
  packageName?: string;
  framework: string;
  role: ProjectRootRole;
  fileCountHint?: number;
  reason: string;
}

function selectionReason(role: ProjectRootRole, framework: string): string {
  if (role === "primary") return `Primary ${framework} application`;
  if (role === "workspace") return `Workspace member (${framework})`;
  if (role === "unknown") return `Detected ${framework} project root`;
  return `Classified as ${role}`;
}

export function analyzableApplicationRoots(model: RepositoryModel): ClassifiedProjectRoot[] {
  return classifyProjectRoots(model).filter(
    (p) => !NON_APPLICATION_ROLES.has(p.role) && p.framework !== "unknown"
  );
}

export function needsProjectRootSelection(model: RepositoryModel): boolean {
  const apps = analyzableApplicationRoots(model);
  const distinctRoots = new Set(apps.map((p) => p.relativePath || "."));
  return distinctRoots.size > 1;
}

export function listSelectableApplicationRoots(
  model: RepositoryModel
): SelectableApplicationRoot[] {
  return analyzableApplicationRoots(model).map((p) => ({
    projectRoot: p.relativePath || ".",
    packageName: p.packageName,
    framework: p.framework,
    role: p.role,
    reason: selectionReason(p.role, p.framework),
  }));
}

export function resolveSelectedProjectRoot(
  model: RepositoryModel,
  selected?: string | null
): string {
  const selectable = listSelectableApplicationRoots(model);
  if (!selectable.length) return "";
  if (selected && selectable.some((s) => s.projectRoot === selected)) {
    return selected;
  }
  if (selectable.length === 1) return selectable[0].projectRoot;
  const primary = selectable.find((s) => s.role === "primary");
  return primary?.projectRoot ?? selectable[0].projectRoot;
}
