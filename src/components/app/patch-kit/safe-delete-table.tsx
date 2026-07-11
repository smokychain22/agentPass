"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SafeDeleteRow } from "./patch-kit-utils";

export function SafeDeleteTable({ rows }: { rows: SafeDeleteRow[] }) {
  return (
    <Card className="border-border/80">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Safe Delete Plan</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Only Safe Candidate files are included in repodiet-cleanup.patch.
        </p>
      </CardHeader>
      <CardContent className="px-0 pb-0 overflow-x-auto">
        {rows.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed">
            No automatic delete operations generated. Current findings require review before
            patching.
          </p>
        ) : (
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium">Reason</th>
                <th className="px-3 py-2 font-medium">Confidence</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Patch status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.file}
                  className="border-b border-border/60 hover:bg-muted/20 transition-colors"
                >
                  <td className="px-3 py-2.5 font-mono text-xs">{row.file}</td>
                  <td className="px-3 py-2.5 text-sm text-muted-foreground max-w-[220px]">
                    {row.reason}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-sm tabular-nums">
                    {row.confidence != null ? `${Math.round(row.confidence * 100)}%` : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge variant="signal" className="text-[10px] font-normal">
                      {row.action}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-electric/90">
                    {row.patchStatus}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
