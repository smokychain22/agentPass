import fs from "node:fs/promises";
import path from "node:path";
import type { FileTreeScan } from "@/lib/scanner/file-tree";
import type { RepositoryModel } from "@/lib/repository-model/types";
import {
  configurationDigest,
  REPOSITORY_GRAPH_SCANNER_VERSION,
  repositoryGraphId,
  type PersistedRepositoryGraph,
  type RepositoryGraphEdge,
  type RepositoryGraphNode,
} from "./types";

const IMPORT_RE =
  /(?:import\s+(?:[\s\S]*?)\s+from\s+|export\s+(?:[\s\S]*?)\s+from\s+|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;

function nodeId(kind: string, key: string): string {
  return `${kind}:${key}`;
}

export async function buildPersistedRepositoryGraph(input: {
  repository: string;
  branch: string;
  sourceCommit: string;
  projectRoot: string;
  rootDir: string;
  tree: FileTreeScan;
  repositoryModel: RepositoryModel;
  packageScripts?: Array<{ name: string; command: string; projectRoot: string }>;
  tsconfigPaths?: Record<string, string[]>;
}): Promise<PersistedRepositoryGraph> {
  const identity = {
    repository: input.repository,
    branch: input.branch,
    sourceCommit: input.sourceCommit,
    projectRoot: input.projectRoot || ".",
    scannerVersion: REPOSITORY_GRAPH_SCANNER_VERSION,
    configurationDigest: configurationDigest({
      tsconfigPaths: input.tsconfigPaths ?? {},
      workspaces: input.repositoryModel.workspaces,
      monorepoTool: input.repositoryModel.monorepoTool ?? null,
    }),
  };

  const nodes: RepositoryGraphNode[] = [];
  const edges: RepositoryGraphEdge[] = [];
  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();

  function addNode(node: RepositoryGraphNode) {
    if (seenNodes.has(node.id)) return;
    seenNodes.add(node.id);
    nodes.push(node);
  }

  function addEdge(edge: RepositoryGraphEdge) {
    if (seenEdges.has(edge.id)) return;
    seenEdges.add(edge.id);
    edges.push(edge);
  }

  const sourceFiles = (input.tree.inventory?.files ?? [])
    .filter((f) => f.kind === "supported_source" || f.kind === "protected" || f.kind === "test")
    .map((f) => f.path);

  const fallbackSources = input.tree.allRelativePaths.filter((p) =>
    /\.(tsx?|jsx?|mjs|cjs|mts|cts)$/i.test(p)
  );
  const files = sourceFiles.length > 0 ? sourceFiles : fallbackSources;

  for (const filePath of files) {
    addNode({
      id: nodeId("file", filePath),
      kind: "file",
      path: filePath,
    });
    addNode({
      id: nodeId("module", filePath),
      kind: "module",
      path: filePath,
    });

    const ctx = input.repositoryModel.fileIndex[filePath];
    if (ctx?.entrypointRole && ctx.entrypointRole !== "library" && ctx.entrypointRole !== "unknown") {
      addNode({
        id: nodeId("route", filePath),
        kind: ctx.entrypointRole.includes("route") || ctx.entrypointRole.includes("page")
          ? "route"
          : "file",
        path: filePath,
        name: ctx.entrypointRole,
        meta: { role: ctx.entrypointRole },
      });
    }

    try {
      const raw = await fs.readFile(path.join(input.rootDir, filePath), "utf8");
      IMPORT_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = IMPORT_RE.exec(raw))) {
        const spec = match[1];
        if (!spec) continue;
        const kind = match[0].includes("import(")
          ? "dynamic_import"
          : match[0].includes("require")
            ? "require"
            : match[0].trimStart().startsWith("export")
              ? "export_reexport"
              : "static_import";
        const toId = nodeId("module", spec.startsWith(".") ? `${filePath}::${spec}` : spec);
        addNode({
          id: toId,
          kind: "module",
          name: spec,
          meta: { unresolved: spec.startsWith(".") ? false : !spec.startsWith("/") },
        });
        addEdge({
          id: `${kind}:${filePath}->${spec}`,
          kind,
          from: nodeId("module", filePath),
          to: toId,
          meta: { specifier: spec },
        });
      }
    } catch {
      /* unreadable source — still keep file node */
    }
  }

  for (const script of input.packageScripts ?? []) {
    const id = nodeId("package_script", `${script.projectRoot}:${script.name}`);
    addNode({
      id,
      kind: "package_script",
      name: script.name,
      meta: { command: script.command, projectRoot: script.projectRoot },
    });
  }

  for (const [configPath, ctx] of Object.entries(input.repositoryModel.fileIndex)) {
    if (ctx.entrypointRole === "config" || configPath.endsWith("package.json")) {
      addNode({
        id: nodeId("configuration", configPath),
        kind: "configuration",
        path: configPath,
      });
    }
    if (ctx.entrypointRole === "test") {
      addNode({
        id: nodeId("test", configPath),
        kind: "test",
        path: configPath,
      });
    }
  }

  const now = new Date().toISOString();
  return {
    id: repositoryGraphId(identity),
    identity,
    nodes,
    edges,
    fileCount: files.length,
    edgeCount: edges.length,
    createdAt: now,
    updatedAt: now,
  };
}
