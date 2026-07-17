"use client";

import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/design-system/panel";
import type { ScanCoverageReport, ScanCoverageStatus } from "@/lib/scanner/intelligence-manifest";
import type { RepositoryIntelligenceManifest } from "@/lib/scanner/intelligence-manifest";
import type { ScanPayload } from "@/lib/scanner/run-scan";
import { cn } from "@/lib/utils";

function statusLabel(status: ScanCoverageStatus): string {
  switch (status) {
    case "complete":
      return "Complete";
    case "complete_with_exclusions":
      return "Complete with exclusions";
    case "partial":
      return "Partial";
    case "failed":
      return "Failed";
  }
}

function statusVariant(
  status: ScanCoverageStatus
): "default" | "neutral" | "amber" | "danger" {
  switch (status) {
    case "complete":
      return "default";
    case "complete_with_exclusions":
      return "neutral";
    case "partial":
      return "amber";
    case "failed":
      return "danger";
  }
}

export function ScanCoveragePanel({
  scan,
  manifest,
}: {
  scan: ScanPayload;
  manifest?: RepositoryIntelligenceManifest | null;
}) {
  const coverage: ScanCoverageReport | undefined =
    manifest?.coverage ?? scan.scanCoverage ?? undefined;

  if (!coverage) return null;

  return (
    <Panel variant="elevated" padding="md" className="border-border/60">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <p className="ds-label">Repository intelligence & scan coverage</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Structure scan pins commit, classifies entry points, and measures coverage before Findings
            analyzers run.
          </p>
        </div>
        <Badge variant={statusVariant(coverage.status)} className="font-mono text-[10px] uppercase">
          {statusLabel(coverage.status)}
        </Badge>
      </div>

      {(manifest?.identity.commitSha || scan.repo.commitSha) && (
        <p className="mb-3 font-mono text-[11px] text-muted-foreground">
          Commit{" "}
          <span className="text-foreground">
            {(manifest?.identity.commitSha ?? scan.repo.commitSha)?.slice(0, 12)}
          </span>
        </p>
      )}

      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Total files</dt>
          <dd className="font-mono text-lg">
            {(coverage.contract?.totalFiles ?? coverage.filesDiscovered).toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Classified files</dt>
          <dd className="font-mono text-lg">{coverage.filesClassified.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Supported JS/TS source files</dt>
          <dd className="font-mono text-lg">
            {(coverage.contract?.supportedSourceFiles ?? coverage.filesAnalyzable).toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Analyzed source files</dt>
          <dd className="font-mono text-lg">
            {(coverage.contract?.analyzedSourceFiles ?? 0).toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Configuration files</dt>
          <dd className="font-mono text-lg">
            {(coverage.contract?.configurationFilesIndexed ?? 0).toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Entry points</dt>
          <dd className="font-mono text-lg">{coverage.entryPointsDetected.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Protected paths</dt>
          <dd className="font-mono text-lg">{coverage.filesProtected.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Excluded files</dt>
          <dd className="font-mono text-lg">{coverage.filesExcluded.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Top-level folders</dt>
          <dd className="font-mono text-lg">
            {(
              scan.topLevelFolders?.length ??
              manifest?.inventory.totalFolders ??
              scan.summary.totalFolders ??
              0
            ).toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Total directories</dt>
          <dd className="font-mono text-lg">
            {(
              manifest?.inventory.totalFolders ??
              scan.intelligenceManifest?.inventory.totalFolders ??
              scan.summary.totalFolders ??
              0
            ).toLocaleString()}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">Findings readiness</dt>
          <dd className={cn(coverage.readinessForFindings ? "text-signal" : "text-amber-400")}>
            {coverage.readinessForFindings
              ? "Ready — analyzers can run on pinned tree"
              : "Not ready — resolve partial coverage before trusting results"}
          </dd>
        </div>
      </dl>

      {manifest && manifest.structure.workspaces.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">Detected workspaces</p>
          <ul className="font-mono text-[11px] text-muted-foreground space-y-1">
            {manifest.structure.workspaces.map((ws) => (
              <li key={ws} className="text-foreground">
                {ws}
              </li>
            ))}
          </ul>
        </div>
      )}

      {manifest && manifest.structure.packageScripts.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">Package scripts (primary)</p>
          <ul className="font-mono text-[11px] text-muted-foreground space-y-1 max-h-24 overflow-auto">
            {manifest.structure.packageScripts.slice(0, 8).map((s) => (
              <li key={`${s.projectRoot}:${s.name}`}>
                <span className="text-foreground">{s.name}</span> — {s.command.slice(0, 60)}
                {s.command.length > 60 ? "…" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {manifest && manifest.entryPoints.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">Detected entry points</p>
          <ul className="font-mono text-[11px] text-muted-foreground space-y-1 max-h-32 overflow-auto">
            {manifest.entryPoints.slice(0, 12).map((ep) => (
              <li key={ep.path}>
                <span className="text-foreground">{ep.path}</span>
                <span className="text-muted-foreground/80"> · {ep.role}</span>
              </li>
            ))}
            {manifest.entryPoints.length > 12 && (
              <li>+{manifest.entryPoints.length - 12} more</li>
            )}
          </ul>
        </div>
      )}

      {coverage.warnings.length > 0 && (
        <ul className="mt-4 space-y-1 text-xs text-amber-400/90">
          {coverage.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {coverage.status === "partial" || coverage.status === "failed" ? (
        <p className="mt-4 text-xs text-muted-foreground border-t border-border/50 pt-3">
          RepoDiet will not treat a partial structure scan as proof the repository is clean. Re-scan or
          fix archive access before running Findings.
        </p>
      ) : null}
    </Panel>
  );
}
