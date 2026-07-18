"use client";

import { useDeferredValue, useMemo, useState, useTransition } from "react";
import type { RepositoryPathNode } from "@/lib/user-directed/types";
import {
  filterInventoryNodes,
  selectFolderContents,
} from "@/lib/user-directed/inventory";

type Props = {
  nodes: RepositoryPathNode[];
  selectedPathIds: string[];
  onSelectionChange: (pathIds: string[]) => void;
  loading?: boolean;
  error?: string | null;
};

export function RepositoryExplorer({
  nodes,
  selectedPathIds,
  onSelectionChange,
  loading,
  error,
}: Props) {
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("");
  const [generatedOnly, setGeneratedOnly] = useState(false);
  const [folder, setFolder] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [, startTransition] = useTransition();

  const selected = useMemo(() => new Set(selectedPathIds), [selectedPathIds]);
  const blobs = useMemo(() => nodes.filter((n) => n.type === "blob"), [nodes]);

  const filtered = useMemo(() => {
    let list = filterInventoryNodes(nodes, {
      search: deferredQuery,
      language: language || undefined,
      onlyBlobs: true,
      prefix: folder || undefined,
    });
    if (generatedOnly) {
      list = list.filter((n) => n.generated || n.vendor);
    }
    return list;
  }, [nodes, deferredQuery, language, generatedOnly, folder]);

  const languages = useMemo(() => {
    const set = new Set<string>();
    for (const n of blobs) {
      if (n.language) set.add(n.language);
    }
    return [...set].sort();
  }, [blobs]);

  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const n of blobs) {
      const slash = n.path.lastIndexOf("/");
      if (slash > 0) set.add(n.path.slice(0, slash));
    }
    return [...set].sort().slice(0, 80);
  }, [blobs]);

  function toggle(pathId: string) {
    startTransition(() => {
      const next = new Set(selected);
      if (next.has(pathId)) next.delete(pathId);
      else next.add(pathId);
      onSelectionChange([...next]);
    });
  }

  function selectAllFiltered() {
    startTransition(() => {
      const next = new Set(selected);
      for (const n of filtered) next.add(n.pathId);
      onSelectionChange([...next]);
    });
  }

  function selectFolder(prefix: string) {
    startTransition(() => {
      const paths = selectFolderContents(
        blobs.map((b) => b.path),
        prefix
      );
      const byPath = new Map(blobs.map((b) => [b.path, b.pathId]));
      const next = new Set(selected);
      for (const p of paths) {
        const id = byPath.get(p);
        if (id) next.add(id);
      }
      onSelectionChange([...next]);
    });
  }

  return (
    <section
      className="space-y-4 rounded-md border border-border/50 bg-card/30 p-4"
      aria-label="Repository explorer"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Repository Explorer
          </p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">Select any tracked path</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Select any repository path, then choose what you want RepoDiet to inspect or change.
            Selection does not authorize cleanup — only a verified transformation plan can execute.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded border border-border/50 px-2 py-1 text-muted-foreground">
            {blobs.length} tracked files
          </span>
          <span className="rounded border border-border/50 px-2 py-1 text-muted-foreground">
            {selectedPathIds.length} selected
          </span>
        </div>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading pinned inventory…</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-xs text-muted-foreground">
          Search paths
          <input
            className="mt-1 w-full rounded-md border border-border/50 bg-background px-2 py-1.5 text-sm text-foreground"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by path…"
            aria-label="Search repository paths"
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          Language / format
          <select
            className="mt-1 w-full rounded-md border border-border/50 bg-background px-2 py-1.5 text-sm text-foreground"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            aria-label="Filter by language"
          >
            <option value="">All</option>
            {languages.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-muted-foreground">
          Folder
          <select
            className="mt-1 w-full rounded-md border border-border/50 bg-background px-2 py-1.5 text-sm text-foreground"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            aria-label="Filter by folder"
          >
            <option value="">All folders</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-end gap-2 pb-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={generatedOnly}
            onChange={(e) => setGeneratedOnly(e.target.checked)}
          />
          Generated / vendor only
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md border border-border/50 px-3 py-1.5 text-xs text-foreground hover:bg-accent"
          onClick={selectAllFiltered}
        >
          Select filtered
        </button>
        {folder ? (
          <button
            type="button"
            className="rounded-md border border-border/50 px-3 py-1.5 text-xs text-foreground hover:bg-accent"
            onClick={() => selectFolder(folder)}
          >
            Select folder contents
          </button>
        ) : null}
        <button
          type="button"
          className="rounded-md border border-border/50 px-3 py-1.5 text-xs text-foreground hover:bg-accent"
          onClick={() => onSelectionChange([])}
        >
          Clear selection
        </button>
      </div>

      <div className="max-h-[28rem] overflow-auto rounded-md border border-border/40">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-card/95 text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-medium">Select</th>
              <th className="px-2 py-2 font-medium">Path</th>
              <th className="px-2 py-2 font-medium">Indicators</th>
              <th className="px-2 py-2 font-medium">Refs</th>
              <th className="px-2 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 400).map((node) => (
              <tr key={node.pathId} className="border-t border-border/30" data-path-id={node.pathId}>
                <td className="px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={selected.has(node.pathId)}
                    onChange={() => toggle(node.pathId)}
                    aria-label={`Select ${node.path}`}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <code className="break-all text-[11px] text-foreground">{node.path}</code>
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex flex-wrap gap-1">
                    {node.generated ? (
                      <span className="rounded border border-amber-500/40 px-1 text-amber-200">
                        generated
                      </span>
                    ) : null}
                    {node.vendor ? (
                      <span className="rounded border border-amber-500/40 px-1 text-amber-200">
                        vendor
                      </span>
                    ) : null}
                    {node.protected ? (
                      <span className="rounded border border-destructive/40 px-1 text-destructive">
                        protected
                      </span>
                    ) : null}
                    {(node.findingIds?.length ?? 0) > 0 ? (
                      <span className="rounded border border-electric/40 px-1 text-electric">
                        finding
                      </span>
                    ) : null}
                    {node.language ? (
                      <span className="rounded border border-border/40 px-1 text-muted-foreground">
                        {node.language}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{node.inboundRefs ?? "—"}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{node.gitStatus ?? "tracked"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 400 ? (
          <p className="p-2 text-xs text-muted-foreground">
            Showing 400 of {filtered.length} matching paths. Narrow the filter to browse further —
            selection across filters is preserved.
          </p>
        ) : null}
        {!loading && filtered.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No tracked paths match the current filters.</p>
        ) : null}
      </div>
    </section>
  );
}
