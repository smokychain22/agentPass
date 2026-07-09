"use client";

import { useState } from "react";
import { Check, Copy, Download, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { copyText, downloadTextFile } from "@/lib/patch-kit/client";
import type { ArtifactDefinition } from "./patch-kit-utils";
import { cn } from "@/lib/utils";

const PREVIEW_LIMIT = 2400;

export function ArtifactCard({
  artifact,
  content,
}: {
  artifact: ArtifactDefinition;
  content: string;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const preview =
    content.length > PREVIEW_LIMIT ? `${content.slice(0, PREVIEW_LIMIT)}\n…` : content;

  const handleCopy = async () => {
    await copyText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    downloadTextFile(content, artifact.filename, artifact.mime);
  };

  return (
    <Card className="border-border/80 bg-card/60">
      <CardHeader className="pb-2">
        <CardTitle className="font-mono text-sm font-medium">{artifact.filename}</CardTitle>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{artifact.description}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPreviewOpen((v) => !v)}
          >
            {previewOpen ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            {previewOpen ? "Hide" : "Preview"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleCopy}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            Copy
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="h-3.5 w-3.5" />
            Download
          </Button>
        </div>
        {previewOpen && (
          <pre
            className={cn(
              "max-h-56 overflow-auto rounded-md border border-border bg-muted/20 p-3",
              "font-mono text-[11px] leading-relaxed text-muted-foreground",
              "scrollbar-thin"
            )}
          >
            {preview}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
