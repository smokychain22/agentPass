"use client";

import { Button } from "@/components/ui/button";
import { Panel } from "@/components/design-system/panel";
import type { ScanPayload } from "@/lib/scanner/run-scan";

export function ProjectRootSelectionPanel({
  scan,
  selectedRoot,
  onSelect,
}: {
  scan: ScanPayload;
  selectedRoot?: string;
  onSelect: (projectRoot: string) => void;
}) {
  const apps = scan.repositoryModel?.selectableApplications ?? [];
  if (!scan.repositoryModel?.needsProjectRootSelection || apps.length < 2) return null;

  return (
    <Panel variant="elevated" padding="md">
      <p className="ds-label mb-2">Select application to analyze</p>
      <p className="mb-4 text-sm text-muted-foreground">
        RepoDiet found multiple application roots. Choose one before running Findings — unrelated
        roots are not merged into a single cleanup graph.
      </p>
      <div className="space-y-2">
        {apps.map((app) => {
          const active = (selectedRoot ?? scan.repositoryModel?.primaryProjectRoot) === app.projectRoot;
          return (
            <button
              key={app.projectRoot}
              type="button"
              onClick={() => onSelect(app.projectRoot)}
              className={`flex w-full flex-col rounded-md border px-4 py-3 text-left transition-colors ${
                active
                  ? "border-electric/40 bg-electric/10"
                  : "border-border/40 hover:border-border/60"
              }`}
            >
              <span className="font-mono text-sm text-foreground">{app.projectRoot}</span>
              <span className="mt-1 text-xs text-muted-foreground">
                {app.framework} · {app.role} · {app.reason}
              </span>
              {app.packageName && (
                <span className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {app.packageName}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {!selectedRoot && (
        <p className="mt-4 text-xs text-amber-300">
          Findings stays locked until you select an application root.
        </p>
      )}
      {selectedRoot && (
        <div className="mt-4">
          <Button asChild>
            <a href="/app?tab=findings">Run Findings for {selectedRoot}</a>
          </Button>
        </div>
      )}
    </Panel>
  );
}
