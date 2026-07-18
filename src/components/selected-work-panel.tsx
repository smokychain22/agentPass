"use client";

import { useState } from "react";
import type {
  RequestedActionType,
  TransformationPlan,
} from "@/lib/user-directed/types";
import { REQUESTED_ACTION_TYPES } from "@/lib/user-directed/types";

const ACTION_LABELS: Record<RequestedActionType, string> = {
  INSPECT: "Inspect",
  DELETE: "Delete",
  EDIT: "Edit",
  RENAME: "Rename",
  MOVE: "Move",
  CONSOLIDATE_DUPLICATES: "Consolidate duplicate",
  CHOOSE_CANONICAL: "Choose as canonical duplicate",
  REMOVE_DEPENDENCY: "Remove dependency",
  UPDATE_REFERENCES: "Replace references",
  UPDATE_CONFIGURATION: "Update configuration",
  REGENERATE: "Regenerate",
  KEEP: "Keep and suppress suggestion",
  SUPPRESS: "Add to ignore policy",
  ADD_IGNORE_POLICY: "Add to ignore policy",
  CUSTOM: "Request custom cleanup",
};

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
}: Props) {
  const [actionType, setActionType] = useState<RequestedActionType>("DELETE");
  const [instruction, setInstruction] = useState("");
  const [canonicalPath, setCanonicalPath] = useState("");

  const needsInstruction = actionType === "EDIT" || actionType === "CUSTOM";
  const needsCanonical =
    actionType === "CHOOSE_CANONICAL" || actionType === "CONSOLIDATE_DUPLICATES";

  return (
    <section className="space-y-4 rounded-md border border-border/50 bg-card/30 p-4" aria-label="Selected work">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Selected Work</p>
        <h2 className="mt-1 text-lg font-semibold text-foreground">Configure requested action</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every tracked path may be selected. Only a verified TransformationPlan may be executed.
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
          Select paths in Repository Explorer or findings in Suggestions, then choose an action.
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
            {selectedPaths.length > 40 ? (
              <p className="text-xs text-muted-foreground">…and {selectedPaths.length - 40} more</p>
            ) : null}
          </div>

          <div className="grid gap-3">
            <label className="block text-xs text-muted-foreground">
              Requested action
              <select
                className="mt-1 w-full rounded-md border border-border/50 bg-background px-2 py-1.5 text-sm"
                value={actionType}
                onChange={(e) => setActionType(e.target.value as RequestedActionType)}
              >
                {REQUESTED_ACTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ACTION_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>

            {needsCanonical ? (
              <label className="block text-xs text-muted-foreground">
                Canonical path (optional — leave blank for RepoDiet recommendation)
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
                ? "Describe the edit or custom cleanup"
                : "Additional instruction (optional)"}
              <textarea
                className="mt-1 w-full rounded-md border border-border/50 bg-background px-2 py-1.5 text-sm"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={3}
                placeholder={
                  needsInstruction
                    ? "e.g. remove unused function foo, update references, clean comments"
                    : "Optional notes for planning"
                }
              />
            </label>
          </div>

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
              {analyzing ? "Analyzing selected scope…" : "Analyze selected scope"}
            </button>
            <button
              type="button"
              className="rounded-md border border-border/50 px-3 py-1.5 text-sm"
              onClick={onClearSelection}
            >
              Clear selection
            </button>
          </div>

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
                <span className="rounded border border-border/40 px-2 py-0.5">{plan.riskTier}</span>
              </div>
              <p className="mt-2 text-foreground/90">{plan.summary}</p>
              {plan.nextStep ? (
                <p className="mt-1 text-xs text-muted-foreground">Next: {plan.nextStep}</p>
              ) : null}
              {plan.blockerReason ? (
                <p className="mt-1 text-xs text-warning">Blocker: {plan.blockerReason}</p>
              ) : null}
              <ul className="mt-2 text-xs text-muted-foreground">
                {plan.selectedRepositoryPaths.map((p) => (
                  <li key={p}>
                    <code>{p}</code>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
