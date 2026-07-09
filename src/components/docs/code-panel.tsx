"use client";

import { CopyButton } from "./copy-button";
import { cn } from "@/lib/utils";

export function CodePanel({
  code,
  language = "json",
  copyLabel = "Copy",
  className,
}: {
  code: string;
  language?: string;
  copyLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-md border border-border bg-muted/20", className)}>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {language}
        </span>
        <CopyButton text={code} label={copyLabel} variant="ghost" size="sm" />
      </div>
      <pre className="max-h-80 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-muted-foreground scrollbar-thin">
        {code}
      </pre>
    </div>
  );
}
