"use client";

import type { Finding } from "@/lib/findings/types";
import {
  controlledDeliveryRejectReason,
  evaluateControlledDeliverySelection,
  isControlledDeliveryPreferredPath,
  normalizeCleanupPath,
} from "@/lib/cleanup/controlled-delivery-scope";
import { resolvePhase1Plugin } from "@/lib/execution/fix-plugins/phase1-plugins";

function proposedOperation(finding: Finding): string {
  const plugin = resolvePhase1Plugin(finding);
  if (plugin.id.startsWith("remove_") || plugin.id === "consolidate_exact_duplicate") {
    if (finding.type === "duplicate_code") return "consolidate (rewire importers + delete duplicate)";
    return "delete";
  }
  return plugin.id === "review_only" ? "review only" : plugin.id;
}

function patchPreviewForFinding(finding: Finding): {
  before: string;
  after: string;
  filesChanged: number;
  filesDeleted: number;
  unexpectedChangeBudget: string;
} {
  const path = normalizeCleanupPath(finding.files[0] ?? "");
  const operation = proposedOperation(finding);
  if (operation === "delete") {
    return {
      before: `file exists at ${path || "—"} (full contents shown in worker diff after auth; secrets never inlined here)`,
      after: `${path || "—"} deleted`,
      filesChanged: path ? 1 : 0,
      filesDeleted: path ? 1 : 0,
      unexpectedChangeBudget: "0 files outside selected finding paths",
    };
  }
  if (finding.type === "duplicate_code") {
    return {
      before: `duplicate cluster involving ${finding.files.join(", ") || "—"}`,
      after: "importers rewired to canonical file; duplicate path(s) removed",
      filesChanged: Math.max(finding.files.length, 1),
      filesDeleted: Math.max(finding.files.length - 1, 0),
      unexpectedChangeBudget: "0 files outside selected finding paths",
    };
  }
  return {
    before: finding.evidence.summary || "see finding evidence",
    after: operation,
    filesChanged: finding.files.length || 1,
    filesDeleted: 0,
    unexpectedChangeBudget: "0 files outside selected finding paths",
  };
}

export function PrePaymentCleanupPreview(props: {
  findings: Finding[];
  pinnedCommit: string;
  repository: string;
}) {
  const { findings, pinnedCommit, repository } = props;
  const paths = findings.flatMap((f) => f.files.map(normalizeCleanupPath));
  const gate = evaluateControlledDeliverySelection(paths);
  const totalDeleted = findings.reduce((n, f) => n + patchPreviewForFinding(f).filesDeleted, 0);
  const totalChanged = findings.reduce((n, f) => n + patchPreviewForFinding(f).filesChanged, 0);

  return (
    <div className="mt-4 space-y-3 rounded-md border border-border/50 bg-card/40 p-3 text-sm">
      <div>
        <p className="font-medium text-foreground">Selected cleanup (inspect before payment)</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Repository <span className="font-mono">{repository}</span> · pinned{" "}
          <span className="font-mono">{pinnedCommit ? `${pinnedCommit.slice(0, 12)}…` : "—"}</span>
        </p>
      </div>

      {!gate.allowed && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <p className="font-medium">Controlled delivery blocked</p>
          <p className="mt-1 text-xs">{gate.message}</p>
        </div>
      )}

      {gate.allowed && gate.message && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-100">
          {gate.message}
        </div>
      )}

      <ul className="space-y-3">
        {findings.map((finding) => {
          const path = normalizeCleanupPath(finding.files[0] ?? "");
          const plugin = resolvePhase1Plugin(finding);
          const operation = proposedOperation(finding);
          const reject = controlledDeliveryRejectReason(path);
          const preferred = isControlledDeliveryPreferredPath(path);
          const patch = patchPreviewForFinding(finding);
          return (
            <li
              key={finding.id}
              className="rounded-md border border-border/40 bg-background/40 p-3 text-xs"
            >
              <dl className="grid gap-1.5 sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Finding ID</dt>
                  <dd className="font-mono">{finding.id}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Type</dt>
                  <dd className="font-mono">{finding.type}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Path</dt>
                  <dd className="font-mono break-all">{path || "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Transformer</dt>
                  <dd className="font-mono">{plugin.id}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Proposed operation</dt>
                  <dd className="font-mono">{operation}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Expected deleted files</dt>
                  <dd className="font-mono">
                    {operation === "delete" ? path : patch.filesDeleted > 0 ? String(patch.filesDeleted) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Expected preserved files</dt>
                  <dd className="font-mono">all other repository paths</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Eligibility</dt>
                  <dd>
                    {finding.action} · {finding.classificationLabel ?? "unclassified"} ·{" "}
                    {preferred ? "preferred controlled path" : reject ? `rejected: ${reject}` : "non-preferred"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Evidence (signals)</dt>
                  <dd className="font-mono break-all text-[11px] text-muted-foreground">
                    {(finding.evidence.signals ?? []).slice(0, 8).join(" · ") || "—"}
                  </dd>
                </div>
              </dl>

              <div className="mt-3 rounded-md border border-border/30 bg-background/50 p-2">
                <p className="font-medium text-foreground">Proposed patch</p>
                <dl className="mt-1 grid gap-1">
                  <div>
                    <dt className="text-muted-foreground">Before</dt>
                    <dd className="font-mono text-[11px] text-muted-foreground">{patch.before}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">After</dt>
                    <dd className="font-mono text-[11px] text-muted-foreground">{patch.after}</dd>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <dt className="text-muted-foreground">Files changed</dt>
                      <dd className="font-mono">{patch.filesChanged}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Files deleted</dt>
                      <dd className="font-mono">{patch.filesDeleted}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Line scope</dt>
                      <dd className="font-mono">entire selected file(s)</dd>
                    </div>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Unexpected-change budget</dt>
                    <dd className="font-mono">{patch.unexpectedChangeBudget}</dd>
                  </div>
                </dl>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="rounded-md border border-border/40 bg-background/30 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Verification before PR</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          <li>Parser / typecheck when repository-defined</li>
          <li>Build check when repository-defined</li>
          <li>Targeted tests when repository-defined</li>
          <li>
            Bounded diff — expected {totalChanged} changed / {totalDeleted} deleted; unexpected-change
            budget 0
          </li>
          <li>Analyzer rerun after patch</li>
          <li>Rollback: close PR / delete cleanup branch; restore from pinned commit</li>
        </ul>
        <p className="mt-2">
          Unified line-by-line diff is produced by the delivery worker after payment. No repository
          secrets or sensitive file contents are shown on this screen.
        </p>
      </div>
    </div>
  );
}

export function selectionBlocksPayment(findings: Finding[]): boolean {
  const paths = findings.flatMap((f) => f.files);
  return !evaluateControlledDeliverySelection(paths).allowed;
}
