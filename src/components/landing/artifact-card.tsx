"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ARTIFACT_PREVIEWS } from "@/lib/marketing/content";

export function ArtifactCards() {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ARTIFACT_PREVIEWS.map((artifact) => {
          const isOpen = expanded === artifact.filename;
          return (
            <button
              key={artifact.filename}
              type="button"
              onClick={() => setExpanded(isOpen ? null : artifact.filename)}
              className={cn(
                "artifact-glow mcc-panel group rounded-lg p-5 text-left",
                isOpen && "border-electric/30 shadow-artifact-hover"
              )}
            >
              <p className="mono-label mb-2">Artifact</p>
              <p className="font-mono text-sm font-medium text-[#F8FAFC]">{artifact.filename}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-secondary">{artifact.purpose}</p>
              <pre className="mt-3 max-h-20 overflow-hidden rounded border mcc-border bg-[#05070A]/80 p-2.5 font-mono text-[10px] leading-relaxed text-[#64748B] group-hover:max-h-24 transition-all">
                {artifact.preview.split("\n").slice(0, 4).join("\n")}
              </pre>
              <span className="mt-3 inline-block font-mono text-[10px] text-electric/80">
                {isOpen ? "Hide full preview" : "Click to expand"}
              </span>
            </button>
          );
        })}
      </div>

      {expanded && (
        <div className="mcc-panel-elevated rounded-lg p-5">
          <p className="font-mono text-sm text-[#F8FAFC]">{expanded}</p>
          <pre className="mt-3 max-h-64 overflow-auto rounded border mcc-border bg-[#05070A] p-4 font-mono text-[11px] leading-relaxed text-secondary scrollbar-thin">
            {ARTIFACT_PREVIEWS.find((a) => a.filename === expanded)?.preview}
          </pre>
        </div>
      )}
    </div>
  );
}
