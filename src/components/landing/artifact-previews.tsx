"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ARTIFACT_PREVIEWS } from "@/lib/marketing/content";

export function ArtifactPreviews() {
  const [openFile, setOpenFile] = useState<string | null>(null);
  const active = ARTIFACT_PREVIEWS.find((a) => a.filename === openFile);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ARTIFACT_PREVIEWS.map((artifact) => (
          <Card key={artifact.filename} className="border-border/80 bg-card/60">
            <CardHeader className="pb-2">
              <CardTitle className="font-mono text-sm font-medium">{artifact.filename}</CardTitle>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {artifact.purpose}
              </p>
            </CardHeader>
            <CardContent>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setOpenFile(openFile === artifact.filename ? null : artifact.filename)
                }
              >
                {openFile === artifact.filename ? "Hide" : "Preview"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      {active && (
        <Card className="border-electric/20 bg-muted/10">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-sm">{active.filename}</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-64 overflow-auto rounded-md border border-border bg-background/50 p-4 font-mono text-[11px] leading-relaxed text-muted-foreground scrollbar-thin">
              {active.preview}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
