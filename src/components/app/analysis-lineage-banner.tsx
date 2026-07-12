"use client";

import { Panel } from "@/components/design-system/panel";
import type { FindingsPayload } from "@/lib/findings/types";
import type { ScanPayload } from "@/lib/scanner/run-scan";
import type { WorkspaceSource } from "@/lib/scanner/prepare-workspace";

function labelForSource(source: WorkspaceSource | undefined): string {
  switch (source) {
    case "github_zip":
      return "Live GitHub archive";
    case "local_demo":
      return "Bundled demo copy";
    case "e2e_fixture":
      return "Test fixture (non-production)";
    default:
      return "Repository workspace";
  }
}

export function AnalysisLineageBanner({
  scan,
  findings,
}: {
  scan?: ScanPayload | null;
  findings?: FindingsPayload | null;
}) {
  const repo = findings?.repo ?? scan?.repo;
  if (!repo?.owner) return null;

  const source =
    findings?.analysisLineage?.workspaceSource ??
    (scan?.repo as { workspaceSource?: WorkspaceSource } | undefined)?.workspaceSource ??
    (findings?.mode === "demo" ? "local_demo" : "github_zip");
  const commitSha = findings?.repo.commitSha ?? scan?.repo.commitSha;
  const scanId = findings?.scanId ?? scan?.id;
  const projectRoot =
    findings?.analysisLineage?.projectRoot ??
    findings?.repositoryModel?.primaryProjectRoot ??
    scan?.repositoryModel?.primaryProjectRoot;

  return (
    <Panel variant="elevated" padding="md" className="border-border/60 bg-card/40">
      <p className="ds-label mb-2">Analysis lineage</p>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Repository</dt>
          <dd className="font-mono text-xs">
            {repo.owner}/{repo.name}@{repo.branch}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Data source</dt>
          <dd>{labelForSource(source)}</dd>
        </div>
        {commitSha && (
          <div>
            <dt className="text-muted-foreground">Pinned commit</dt>
            <dd className="font-mono text-xs">{commitSha.slice(0, 12)}</dd>
          </div>
        )}
        {scanId && (
          <div>
            <dt className="text-muted-foreground">Scan session</dt>
            <dd className="font-mono text-xs">{scanId}</dd>
          </div>
        )}
        {projectRoot && (
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Project root analyzed</dt>
            <dd className="font-mono text-xs">{projectRoot}</dd>
          </div>
        )}
      </dl>
      {source === "e2e_fixture" && (
        <p className="mt-3 text-xs text-amber-400/90">
          This run used a bundled test fixture — not the live GitHub tree. Unset
          REPODIET_USE_E2E_FIXTURE for production analysis.
        </p>
      )}
    </Panel>
  );
}
