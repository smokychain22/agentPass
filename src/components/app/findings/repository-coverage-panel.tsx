"use client";

import type { UniversalCoverageReport } from "@/lib/coverage/types";
import { Panel } from "@/components/design-system/panel";
import { FindingsAccordion } from "./findings-accordion";

function pct(n: number): string {
  if (!Number.isFinite(n)) return "0%";
  return `${Math.round(n * 10) / 10}%`;
}

function PathTable({
  title,
  paths,
  empty,
}: {
  title: string;
  paths: string[];
  empty: string;
}) {
  return (
    <FindingsAccordion title={`${title} — ${paths.length}`} defaultOpen={false}>
      {paths.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="max-h-48 space-y-1 overflow-y-auto font-mono text-[11px] text-muted-foreground scrollbar-thin">
          {paths.slice(0, 200).map((p) => (
            <li key={p} data-coverage-path={p}>
              {p}
            </li>
          ))}
          {paths.length > 200 ? (
            <li className="text-muted-foreground/80">…and {paths.length - 200} more</li>
          ) : null}
        </ul>
      )}
    </FindingsAccordion>
  );
}

interface RepositoryCoveragePanelProps {
  coverage?: UniversalCoverageReport | null;
}

/**
 * Phase 1 Repository Coverage — separates accounting from semantic support.
 * Never claims every language is semantically understood.
 */
export function RepositoryCoveragePanel({ coverage }: RepositoryCoveragePanelProps) {
  if (!coverage) {
    return (
      <Panel variant="elevated" padding="md" className="border-border/60">
        <p className="ds-label mb-2">Repository Coverage</p>
        <p className="text-sm text-muted-foreground">
          Coverage data is not available for this scan. Legacy scans are not marked 100% accounted.
        </p>
      </Panel>
    );
  }

  if (coverage.coverageVersion === "legacy") {
    return (
      <Panel variant="elevated" padding="md" className="border-border/60" data-coverage-version="legacy">
        <p className="ds-label mb-2">Repository Coverage</p>
        <p className="text-sm text-amber-200">
          Legacy scan — pinned-commit inventory was not recorded. Existing findings are preserved.
          Re-run Findings to build Phase 1 accounting coverage. Do not treat this as 100% accounted.
        </p>
      </Panel>
    );
  }

  const generated = coverage.inventory
    .filter((e) => e.finalCoverageOutcome === "GENERATED_CLASSIFIED")
    .map((e) => e.pathExact);
  const vendored = coverage.inventory
    .filter((e) => e.finalCoverageOutcome === "VENDORED_CLASSIFIED")
    .map((e) => e.pathExact);
  const textual = coverage.inventory
    .filter((e) => e.finalCoverageOutcome === "TEXTUALLY_ANALYZED")
    .map((e) => e.pathExact);
  const metadata = coverage.inventory
    .filter((e) => e.finalCoverageOutcome === "METADATA_ANALYZED")
    .map((e) => e.pathExact);
  const binary = coverage.inventory
    .filter((e) => e.finalCoverageOutcome === "BINARY_INSPECTED")
    .map((e) => e.pathExact);
  const protectedPaths = coverage.inventory
    .filter((e) => e.finalCoverageOutcome === "PROTECTED_BY_POLICY")
    .map((e) => e.pathExact);
  const symlinks = coverage.inventory.filter((e) => e.symlink).map((e) => e.pathExact);
  const submodules = coverage.inventory.filter((e) => e.submodule).map((e) => e.pathExact);
  const lfs = coverage.inventory
    .filter((e) => e.materializationStatus === "LFS_POINTER")
    .map((e) => e.pathExact);

  return (
    <Panel
      variant="elevated"
      padding="md"
      className="border-border/60"
      data-coverage-version="phase1"
      data-accounting-coverage={coverage.accountingCoveragePercent}
      data-semantic-coverage={coverage.semanticCoveragePercent}
    >
      <p className="ds-label mb-2">Repository Coverage</p>
      <p className="mb-3 text-sm text-muted-foreground">
        Every tracked Git path is accounted for. Semantic coverage is reported separately and does
        not imply universal language support or automatic cleanup.
      </p>

      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Repository accounting</dt>
          <dd className="font-mono text-lg text-signal" data-metric="accounting">
            {pct(coverage.accountingCoveragePercent)} — {coverage.accountedForPaths} /{" "}
            {coverage.trackedGitPaths} tracked paths
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Semantic analysis</dt>
          <dd className="font-mono text-lg" data-metric="semantic">
            {pct(coverage.semanticCoveragePercent)}
            <span className="ml-2 text-xs text-muted-foreground">
              ({coverage.semanticPathCount})
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Structural analysis</dt>
          <dd className="font-mono text-lg" data-metric="structural">
            {pct(coverage.structuralCoveragePercent)}
            <span className="ml-2 text-xs text-muted-foreground">
              ({coverage.structuralPathCount})
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Textual fallback</dt>
          <dd className="font-mono text-lg" data-metric="textual">
            {coverage.textualPathCount} paths
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Metadata / binary / classification</dt>
          <dd className="font-mono text-lg" data-metric="fallback">
            {pct(coverage.fallbackCoveragePercent)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Claims full semantic analysis</dt>
          <dd className="font-mono text-lg" data-metric="claims-semantic">
            {coverage.claimsSemanticAnalysisOfAllFiles ? "yes" : "no"}
          </dd>
        </div>
      </dl>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Binary inspection", coverage.binaryPathCount],
          ["Generated classification", coverage.generatedPathCount],
          ["Vendored classification", coverage.vendoredPathCount],
          ["Protected-by-policy", coverage.protectedPathCount],
          ["Unreadable paths", coverage.unreadablePathCount],
          ["Analyzer failure paths", coverage.analyzerFailurePathCount],
          ["Materialization mismatches", coverage.materializationMismatchCount],
          ["Non-authoritative worktree files", coverage.nonAuthoritativeWorktreeArtifacts.length],
        ].map(([label, count]) => (
          <div key={String(label)} className="rounded-md border border-border/40 px-3 py-2">
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className="font-mono text-base">{count}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        <PathTable
          title="Analyzer failures"
          paths={coverage.analyzerFailures}
          empty="No analyzer-failure terminal outcomes."
        />
        <PathTable
          title="Unreadable paths"
          paths={coverage.unreadablePaths}
          empty="No unreadable tracked paths."
        />
        <PathTable
          title="Materialization mismatches"
          paths={coverage.materializationMismatches}
          empty="Worktree matches pinned Git tree for tracked paths."
        />
        <PathTable title="Textual fallbacks" paths={textual} empty="No textual-fallback paths." />
        <PathTable title="Metadata-only paths" paths={metadata} empty="No metadata-only paths." />
        <PathTable title="Binary inspection" paths={binary} empty="No binary paths." />
        <PathTable title="Generated paths" paths={generated} empty="No generated paths." />
        <PathTable title="Vendored paths" paths={vendored} empty="No vendored paths." />
        <PathTable title="Protected paths" paths={protectedPaths} empty="No protected-policy paths." />
        <PathTable title="Symlinks" paths={symlinks} empty="No symlink objects." />
        <PathTable title="Submodules" paths={submodules} empty="No submodule gitlinks." />
        <PathTable title="Git LFS pointers" paths={lfs} empty="No LFS pointer blobs." />
      </div>
    </Panel>
  );
}
