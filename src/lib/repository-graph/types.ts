import { createHash } from "node:crypto";

export type RepositoryGraphNodeKind =
  | "file"
  | "module"
  | "export"
  | "function"
  | "component"
  | "route"
  | "package_dependency"
  | "package_script"
  | "configuration"
  | "test"
  | "public_api"
  | "generated_output";

export type RepositoryGraphEdgeKind =
  | "static_import"
  | "dynamic_import"
  | "require"
  | "export_reexport"
  | "route_registration"
  | "package_script_reference"
  | "configuration_reference"
  | "test_reference"
  | "public_api_reference"
  | "code_generation"
  | "workspace_dependency";

export interface RepositoryGraphNode {
  id: string;
  kind: RepositoryGraphNodeKind;
  path?: string;
  name?: string;
  meta?: Record<string, unknown>;
}

export interface RepositoryGraphEdge {
  id: string;
  kind: RepositoryGraphEdgeKind;
  from: string;
  to: string;
  meta?: Record<string, unknown>;
}

export interface RepositoryGraphIdentity {
  repository: string;
  branch: string;
  sourceCommit: string;
  projectRoot: string;
  scannerVersion: string;
  configurationDigest: string;
}

export interface PersistedRepositoryGraph {
  id: string;
  identity: RepositoryGraphIdentity;
  nodes: RepositoryGraphNode[];
  edges: RepositoryGraphEdge[];
  fileCount: number;
  edgeCount: number;
  createdAt: string;
  updatedAt: string;
}

export const REPOSITORY_GRAPH_SCANNER_VERSION = "repodiet-graph-v1";

export function configurationDigest(parts: Record<string, unknown>): string {
  const payload = JSON.stringify(parts, Object.keys(parts).sort());
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

export function repositoryGraphId(identity: RepositoryGraphIdentity): string {
  const key = [
    identity.repository,
    identity.branch,
    identity.sourceCommit,
    identity.projectRoot,
    identity.scannerVersion,
    identity.configurationDigest,
  ].join("|");
  return `repo_graph_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}
