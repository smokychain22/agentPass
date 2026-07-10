"use client";

import { useState } from "react";
import { FileCode2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ARTIFACT_PREVIEWS } from "@/lib/marketing/content";

export function ArtifactPreviews() {
  const [openFile, setOpenFile] = useState<string | null>(null);
  const active = ARTIFACT_PREVIEWS.find((a) => a.filename === openFile);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ARTIFACT_PREVIEWS.map((artifact) => (
          <Card
            key={artifact.filename}
            className="bento-card group border-border/70 bg-card/70"
          >
            <CardHeader className="pb-2">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded border border-border/80 bg-muted/30">
                <FileCode2 className="h-4 w-4 text-electric/80" />
              </div>
              <CardTitle className="font-mono text-sm font-medium">{artifact.filename}</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
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
            <pre className="max-h-64 overflow-auto rounded-md border border-border bg-background/60 p-4 font-mono text-[11px] leading-relaxed text-muted-foreground scrollbar-thin">
              {active.preview}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
