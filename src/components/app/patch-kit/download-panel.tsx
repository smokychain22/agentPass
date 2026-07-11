"use client";

import { Download, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BUNDLE_FILE_COUNT } from "@/lib/patch-kit/bundle-manifest";

export function DownloadPanel({
  fileCount = BUNDLE_FILE_COUNT,
  onDownload,
}: {
  fileCount?: number;
  onDownload: () => void;
}) {
  return (
    <Card className="border-electric/30 bg-electric/5">
      <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-electric/30 bg-electric/10">
            <Package className="h-5 w-5 text-electric" />
          </span>
          <div>
            <p className="text-sm font-medium">RepoDiet Patch Bundle Ready</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {fileCount} files included — report, patch, package cleanup, regression checklist,
              Cursor prompt, findings.json, and patchkit-summary.json.
            </p>
          </div>
        </div>
        <Button onClick={onDownload} className="shrink-0">
          <Download className="h-4 w-4" />
          Download ZIP
        </Button>
      </CardContent>
    </Card>
  );
}
