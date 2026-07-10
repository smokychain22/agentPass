"use client";

import { Panel } from "@/components/design-system/panel";
import type { ChangeManifestEntry } from "@/lib/patch-kit/types";

export function ChangeManifestTable({ entries }: { entries: ChangeManifestEntry[] }) {
  if (!entries.length) return null;

  const edits = entries.filter((e) => e.operation === "edit").length;
  const deletes = entries.filter((e) => e.operation === "delete").length;
  const adds = entries.filter((e) => e.operation === "add").length;

  return (
    <Panel variant="elevated" padding="md">
      <p className="ds-label mb-2">Change manifest</p>
      <p className="mb-4 text-sm text-muted-foreground">
        {entries.length} generated change{entries.length === 1 ? "" : "s"} · {edits} edit
        {edits === 1 ? "" : "s"} · {deletes} deletion{deletes === 1 ? "" : "s"}
        {adds > 0 ? ` · ${adds} addition${adds === 1 ? "" : "s"}` : ""}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border/40 text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4">File</th>
              <th className="py-2 pr-4">Operation</th>
              <th className="py-2 pr-4">Transformer</th>
              <th className="py-2 pr-4">Finding</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => (
              <tr key={`${entry.filePath}-${i}`} className="border-b border-border/20">
                <td className="py-2 pr-4 font-mono text-xs">{entry.filePath}</td>
                <td className="py-2 pr-4 capitalize">{entry.operation}</td>
                <td className="py-2 pr-4 font-mono text-xs">{entry.transformationType}</td>
                <td className="py-2 pr-4 font-mono text-[10px] text-muted-foreground">
                  {entry.findingId}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
