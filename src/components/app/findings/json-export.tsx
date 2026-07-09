"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FindingsPayload } from "@/lib/findings/types";

export function JsonExportCard({ payload }: { payload: FindingsPayload }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(payload, null, 2);

  const copyJson = async () => {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadJson = () => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `repodiet-findings-${payload.scanId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="border-border/80">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium font-mono">findings.json</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Full findings payload for A2MCP agents and OKX demo export.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={copyJson}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            Copy JSON
          </Button>
          <Button variant="outline" size="sm" onClick={downloadJson}>
            <Download className="h-4 w-4" />
            Download JSON
          </Button>
        </div>
        <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/20 p-3 font-mono text-[10px] text-muted-foreground scrollbar-thin">
          {json.slice(0, 1200)}
          {json.length > 1200 ? "\n…" : ""}
        </pre>
      </CardContent>
    </Card>
  );
}
