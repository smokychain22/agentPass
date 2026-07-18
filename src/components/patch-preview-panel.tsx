"use client";

import type { TransformationPlan } from "@/lib/user-directed/types";

export type PatchPreviewModel = {
  planId: string;
  unifiedDiff: string;
  filesCreated: string[];
  filesEdited: string[];
  filesDeleted: string[];
  filesRenamed: Array<{ from: string; to: string }>;
  referencesChanged: number;
  dependenciesChanged: string[];
  beforeHash: string;
  afterHash: string;
  additions: number;
  deletions: number;
  validationCommands: string[];
  predictedValidationSeconds: number;
  unexpectedChangeBudget: number;
  rollbackPlan: string;
  secretsRedacted: boolean;
};

type Props = {
  plans: TransformationPlan[];
  preview: PatchPreviewModel | null;
  loading: boolean;
  error: string | null;
  onGeneratePreview: () => void;
};

export function PatchPreviewPanel({
  plans,
  preview,
  loading,
  error,
  onGeneratePreview,
}: Props) {
  const hasPlans = plans.length > 0;

  return (
    <section className="space-y-4 rounded-md border border-border/50 bg-card/30 p-4" aria-label="Patch preview">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Patch Preview</p>
          <h2 className="mt-1 text-lg font-semibold">Exact line-by-line change before payment</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Payment is not required to discover what RepoDiet plans to change. If preflight cannot
            produce a real patch, no payable quote is created.
          </p>
        </div>
        <button
          type="button"
          className="rounded-md bg-electric px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
          disabled={loading || !hasPlans}
          onClick={onGeneratePreview}
        >
          {loading ? "Running isolated preflight…" : "Generate exact patch preview"}
        </button>
      </div>

      {!hasPlans ? (
        <p className="text-sm text-muted-foreground">
          Analyze a selection first so RepoDiet can preflight an exact patch.
        </p>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {preview ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded border border-border/50 px-2 py-1">+{preview.additions}</span>
            <span className="rounded border border-border/50 px-2 py-1">−{preview.deletions}</span>
            <span className="rounded border border-border/50 px-2 py-1">
              {preview.filesDeleted.length} deleted
            </span>
            <span className="rounded border border-border/50 px-2 py-1">
              {preview.filesEdited.length} edited
            </span>
            <span className="rounded border border-border/50 px-2 py-1">
              {preview.filesCreated.length} created
            </span>
            {preview.secretsRedacted ? (
              <span className="rounded border border-amber-500/40 px-2 py-1 text-amber-200">
                secrets redacted
              </span>
            ) : null}
          </div>

          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Before hash</dt>
              <dd>
                <code>{preview.beforeHash.slice(0, 16)}</code>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">After hash</dt>
              <dd>
                <code>{preview.afterHash.slice(0, 16)}</code>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">References changed</dt>
              <dd>{preview.referencesChanged}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Predicted validation</dt>
              <dd>~{preview.predictedValidationSeconds}s</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Unexpected-change budget</dt>
              <dd>{preview.unexpectedChangeBudget} files</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Rollback</dt>
              <dd>{preview.rollbackPlan}</dd>
            </div>
          </dl>

          {preview.filesDeleted.length ? (
            <div>
              <h3 className="text-sm font-medium">Files deleted</h3>
              <ul className="mt-1 text-xs">
                {preview.filesDeleted.map((f) => (
                  <li key={f}>
                    <code>{f}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.filesEdited.length ? (
            <div>
              <h3 className="text-sm font-medium">Files edited</h3>
              <ul className="mt-1 text-xs">
                {preview.filesEdited.map((f) => (
                  <li key={f}>
                    <code>{f}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <h3 className="text-sm font-medium">Validation commands</h3>
            <ul className="mt-1 text-xs">
              {preview.validationCommands.map((c) => (
                <li key={c}>
                  <code>{c}</code>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-medium">Unified diff</h3>
            <pre className="mt-2 max-h-[28rem] overflow-auto rounded-md border border-border/40 bg-background/60 p-3 text-[11px] leading-relaxed">
              {preview.unifiedDiff || "(empty patch)"}
            </pre>
          </div>
        </div>
      ) : null}
    </section>
  );
}
