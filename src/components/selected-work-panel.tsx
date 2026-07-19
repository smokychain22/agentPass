"use client";

import { useMemo, useState } from "react";
import type { Finding } from "@/lib/findings/types";
import type {
  RequestedActionType,
  TransformationPlan,
} from "@/lib/user-directed/types";
import {
  ADVANCED_ACTION_LABELS,
  contextualAdvancedActions,
} from "@/lib/user-directed/advanced-actions";
import { recommendedActionForFinding } from "@/lib/user-directed/recommended-action";

type Props = {
  repository: string;
  pinnedCommit: string;
  selectedPathIds: string[];
  selectedPaths: string[];
  selectedFindingIds: string[];
  analyzing: boolean;
  plans: TransformationPlan[];
  onAnalyze: (input: {
    actionType: RequestedActionType;
    userInstruction: string;
    canonicalPath?: string;
  }) => void;
  onClearSelection: () => void;
  /** Progressive disclosure — hide full action list until More actions */
  progressiveDisclosure?: boolean;
  findings?: Finding[];
};

export function SelectedWorkPanel({
  repository,
  pinnedCommit,
  selectedPathIds,
  selectedPaths,
  selectedFindingIds,
  analyzing,
  plans,
  onAnalyze,
  onClearSelection,
  progressiveDisclosure = false,
  findings = [],
}: Props) {
  const [actionType, setActionType] = useState<RequestedActionType>("DELETE");
  const [instruction, setInstruction] = useState("");
  const [canonicalPath, setCanonicalPath] = useState("");
  const [showMoreActions, setShowMoreActions] = useState(false);

  const relatedFinding = useMemo(() => {
    if (!findings.length) return null;
    const idSet = new Set(selectedFindingIds);
    const pathSet = new Set(selectedPaths);
    return (
      findings.find((f) => idSet.has(f.id)) ||
      findings.find((f) => f.files.some((p) => pathSet.has(p))) ||
      null
    );
  }, [findings, selectedFindingIds, selectedPaths]);

  const contextualActions = useMemo(
    () =>
      contextualAdvancedActions({
        path: selectedPaths[0],
        finding: relatedFinding,
      }),
    [selectedPaths, relatedFinding]
  );

  const recommended = relatedFinding
    ? recommendedActionForFinding(relatedFinding)
    : ("DELETE" as RequestedActionType);

  const needsInstruction = actionType === "EDIT" || actionType === "CUSTOM";
  const needsCanonical =
    actionType === "CHOOSE_CANONICAL" || actionType === "CONSOLIDATE_DUPLICATES";

  return (
    <section className="space-y-4 rounded-md border border-border/50 bg-card/30 p-4" aria-label="Selected work">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Selected Work</p>
        <h2 className="mt-1 text-lg font-semibold text-foreground">
          {progressiveDisclosure ? "What should RepoDiet change?" : "Configure requested action"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {progressiveDisclosure
            ? "Describe the outcome you want. RepoDiet chooses the file operations."
            : "Every tracked path may be selected. Only a verified TransformationPlan may be executed."}
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded border border-border/50 px-2 py-1">{selectedPathIds.length} paths</span>
          <span className="rounded border border-border/50 px-2 py-1">
            {selectedFindingIds.length} findings
          </span>
        </div>
      </div>

      {selectedPaths.length === 0 && selectedFindingIds.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Select paths in Repository Explorer or findings, then choose an action.
        </p>
      ) : (
        <>
          <div>
            <p className="text-xs text-muted-foreground">Selected paths</p>
            <ul className="mt-1 max-h-40 overflow-auto text-xs">
              {selectedPaths.slice(0, 40).map((p) => (
                <li key={p}>
                  <code className="break-all">{p}</code>
                </li>
              ))}
            </ul>
          </div>

          {progressiveDisclosure && !showMoreActions ? (
            <div className="grid gap-2">
              <button
                type="button"
                className="rounded-md bg-electric px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
                disabled={analyzing}
                onClick={() =>
                  onAnalyze({
                    actionType: recommended,
                    userInstruction: `Use RepoDiet recommendation (${recommended})`,
                  })
                }
              >
                Use RepoDiet recommendation
              </button>
              <label className="block text-xs text-muted-foreground">
                Describe a different change
                <textarea
                  className="mt-1 w-full rounded-md border border-border/50 bg-background px-2 py-1.5 text-sm"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  rows={3}
                  placeholder="Describe what you want RepoDiet to change."
                />
              </label>
              <button
                type="button"
                className="rounded-md border border-border/50 px-3 py-1.5 text-sm disabled:opacity-50"
                disabled={analyzing || !instruction.trim()}
                onClick={() =>
                  onAnalyze({
                    actionType: "CUSTOM",
                    userInstruction: instruction.trim(),
                  })
                }
              >
                Apply described change
              </button>
              <button
                type="button"
                className="rounded-md border border-border/50 px-3 py-1.5 text-sm"
                disabled={analyzing}
                onClick={() =>
                  onAnalyze({
                    actionType: "KEEP",
                    userInstruction: "Keep this file",
                  })
                }
              >
                Keep this file
              </button>
              <button
                type="button"
                className="rounded-md border border-border/50 px-3 py-1.5 text-sm text-muted-foreground"
                onClick={() => setShowMoreActions(true)}
              >
                More actions
              </button>
            </div>
          ) : (
            <div className="grid gap-3">
              <label className="block text-xs text-muted-foreground">
                Requested action
                <select
                  className="mt-1 w-full rounded-md border border-border/50 bg-background px-2 py-1.5 text-sm"
                  value={actionType}
                  onChange={(e) => setActionType(e.target.value as RequestedActionType)}
                >
                  {(progressiveDisclosure ? contextualActions : contextualActions).map((t) => (
                    <option key={t} value={t}>
                      {ADVANCED_ACTION_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>

              {needsCanonical ? (
                <label className="block text-xs text-muted-foreground">
                  Canonical path (optional)
                  <select
                    className="mt-1 w-full rounded-md border border-border/50 bg-background px-2 py-1.5 text-sm"
                    value={canonicalPath}
                    onChange={(e) => setCanonicalPath(e.target.value)}
                  >
                    <option value="">RepoDiet recommended</option>
                    {selectedPaths.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label className="block text-xs text-muted-foreground">
                {needsInstruction
                  ? "Describe what you want RepoDiet to change"
                  : "Additional instruction (optional)"}
                <textarea
                  className="mt-1 w-full rounded-md border border-border/50 bg-background px-2 py-1.5 text-sm"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  rows={3}
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md bg-electric px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
                  disabled={analyzing || (needsInstruction && !instruction.trim())}
                  onClick={() =>
                    onAnalyze({
                      actionType,
                      userInstruction: instruction.trim(),
                      canonicalPath: canonicalPath || undefined,
                    })
                  }
                >
                  {analyzing ? "Analyzing…" : "Analyze selected scope"}
                </button>
                {progressiveDisclosure ? (
                  <button
                    type="button"
                    className="rounded-md border border-border/50 px-3 py-1.5 text-sm"
                    onClick={() => setShowMoreActions(false)}
                  >
                    Fewer options
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded-md border border-border/50 px-3 py-1.5 text-sm"
                  onClick={onClearSelection}
                >
                  Clear selection
                </button>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Repository <code>{repository}</code> @{" "}
            <code>{pinnedCommit ? pinnedCommit.slice(0, 12) : "—"}</code>
          </p>
        </>
      )}

      {plans.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">Analysis results</h3>
          {plans.map((plan) => (
            <article
              key={plan.planId}
              className="rounded-md border border-border/40 bg-background/40 p-3 text-sm"
            >
              <div className="flex flex-wrap gap-2 text-xs">
                <span
                  className={`rounded border px-2 py-0.5 ${
                    plan.executable
                      ? "border-signal/40 text-signal"
                      : "border-amber-500/40 text-amber-200"
                  }`}
                >
                  {plan.status}
                </span>
                <span className="rounded border border-border/40 px-2 py-0.5">
                  {plan.proposedAction}
                </span>
              </div>
              <p className="mt-2 text-foreground/90">{plan.summary}</p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
