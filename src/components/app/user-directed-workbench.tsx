"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useAppSession } from "@/components/app/app-session";
import { RepositoryExplorer } from "@/components/repository-explorer";
import { SelectedWorkPanel } from "@/components/selected-work-panel";
import { ChangePlanPanel } from "@/components/change-plan-panel";
import {
  PatchPreviewPanel,
  type PatchPreviewModel,
} from "@/components/patch-preview-panel";
import { QuotePaymentPanel } from "@/components/quote-payment-panel";
import dynamic from "next/dynamic";
import { pathFromId } from "@/lib/user-directed/path-identity";
import {
  DEFAULT_PRODUCT_MODE,
  WORKBENCH_STAGES,
  type ProductMode,
  type WorkbenchStage,
} from "@/lib/user-directed/product-modes";
import {
  allowsDirectWebsitePayment,
  resolveSessionSource,
  type SessionSource,
} from "@/lib/user-directed/session-source";
import { buildScanOutcomeSummary } from "@/lib/user-directed/scan-outcome-summary";
import { flattenFindingsPayload } from "@/lib/findings/selection";
import { riskBucketOf, isCleanupEligible } from "@/lib/findings/cleanup-eligibility";
import { buildGuidedReviewPrompt } from "@/lib/user-directed/guided-review";
import {
  outcomeLabelForFinding,
  recommendedActionForFinding,
  resultLabelForAction,
} from "@/lib/user-directed/recommended-action";
import { plainLanguageWhy } from "@/lib/findings/plain-language";
import type {
  DynamicSignedQuote,
  PaymentChannelChoice,
  RepositoryPathNode,
  RequestedActionType,
  TransformationPlan,
} from "@/lib/user-directed/types";
import { createWorkflowA2ATask } from "@/lib/workflow/client";

const VerifyTab = dynamic(
  () => import("@/components/app/verify-tab").then((m) => m.VerifyTab),
  { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading delivery…</p> }
);

type Props = {
  /** @deprecated Prefer stage — mapped for app/?tab= compatibility */
  initialTab?: string;
  initialStage?: WorkbenchStage;
};

function stageFromLegacyTab(tab?: string): WorkbenchStage {
  switch (tab) {
    case "plan":
    case "patch":
    case "validation":
    case "selected":
      return "plan";
    case "quote":
      return "pay";
    case "delivery":
    case "verify":
      return "delivery";
    default:
      return "review";
  }
}

export type ProductWorkbenchTab = WorkbenchStage;

export function UserDirectedWorkbench({
  initialTab,
  initialStage,
}: Props) {
  const searchParams = useSearchParams();
  const {
    session,
    findings,
    selectedFindingIds,
    setSelectedFindingIds,
    setA2aTask,
    setScopeReviewed,
    a2aTask,
  } = useAppSession();

  const sessionSource: SessionSource = useMemo(
    () =>
      resolveSessionSource({
        querySource: searchParams.get("source") ?? searchParams.get("sessionSource"),
        purchaseChannel: a2aTask?.purchaseChannel ?? null,
        okxJobId: searchParams.get("okxJobId") ?? searchParams.get("jobId"),
        okxTaskId: searchParams.get("taskId") ?? searchParams.get("okxTaskId"),
      }),
    [searchParams, a2aTask?.purchaseChannel]
  );

  const okxOnlyPayment = !allowsDirectWebsitePayment(sessionSource);

  const [stage, setStage] = useState<WorkbenchStage>(
    initialStage ?? stageFromLegacyTab(initialTab)
  );
  const [mode, setMode] = useState<ProductMode>(DEFAULT_PRODUCT_MODE);
  const [nodes, setNodes] = useState<RepositoryPathNode[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [selectedPathIds, setSelectedPathIds] = useState<string[]>([]);
  const [plans, setPlans] = useState<TransformationPlan[]>([]);
  const [excludedFindingIds, setExcludedFindingIds] = useState<string[]>([]);
  const [planSummary, setPlanSummary] = useState<{
    deleteCount: number;
    consolidateCount: number;
    referenceUpdateCount: number;
    editCount: number;
    validationCommands: string[];
  } | null>(null);
  const [lastActionType, setLastActionType] = useState<RequestedActionType>("DELETE");
  const [lastInstruction, setLastInstruction] = useState("");
  const [lastCanonical, setLastCanonical] = useState<string | undefined>();
  const [analyzing, setAnalyzing] = useState(false);
  const [preview, setPreview] = useState<PatchPreviewModel | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [quote, setQuote] = useState<DynamicSignedQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [channel, setChannel] = useState<PaymentChannelChoice | null>(
    okxOnlyPayment ? "okx_a2a_marketplace" : null
  );
  const [authorizing, setAuthorizing] = useState(false);
  const [planOpen, setPlanOpen] = useState({
    selected: true,
    patch: false,
    evidence: false,
    validation: false,
    rollback: false,
  });

  const scanId = session.scanRecordId || session.scanResult?.id;
  const repository =
    session.scanResult?.repo
      ? `${session.scanResult.repo.owner}/${session.scanResult.repo.name}`
      : findings
        ? `${findings.repo.owner}/${findings.repo.name}`
        : "";
  const pinnedCommit =
    session.scanResult?.repo?.commitSha || findings?.repo.commitSha || "";

  const selectedPaths = useMemo(
    () => selectedPathIds.map(pathFromId),
    [selectedPathIds]
  );

  const outcome = useMemo(() => buildScanOutcomeSummary(findings), [findings]);
  const flatFindings = useMemo(
    () => (findings ? flattenFindingsPayload(findings) : []),
    [findings]
  );
  const reviewFindings = useMemo(
    () =>
      flatFindings.filter(
        (f) => riskBucketOf(f) === "REVIEW" && !isCleanupEligible(f)
      ),
    [flatFindings]
  );
  const eligibleFindings = useMemo(
    () =>
      flatFindings.filter(
        (f) => isCleanupEligible(f) && !excludedFindingIds.includes(f.id)
      ),
    [flatFindings, excludedFindingIds]
  );

  const executablePlan = plans.find((p) => p.executable && p.normalizedPatchHash);

  const invalidateQuoteAndPreview = useCallback(() => {
    setPreview(null);
    setQuote(null);
    setQuoteError(null);
    setPreviewError(null);
    if (!okxOnlyPayment) setChannel(null);
  }, [okxOnlyPayment]);

  useEffect(() => {
    if (okxOnlyPayment) setChannel("okx_a2a_marketplace");
  }, [okxOnlyPayment]);

  const onSelectionChange = useCallback(
    (pathIds: string[]) => {
      setSelectedPathIds(pathIds);
      setPlans([]);
      invalidateQuoteAndPreview();
    },
    [invalidateQuoteAndPreview]
  );

  useEffect(() => {
    if (!scanId) return;
    let cancelled = false;
    setInventoryLoading(true);
    setInventoryError(null);
    void fetch(`/api/repository/inventory?scanId=${encodeURIComponent(scanId)}`)
      .then(async (res) => {
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          nodes?: RepositoryPathNode[];
        };
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setInventoryError(data.error || "Failed to load inventory.");
          setNodes([]);
          return;
        }
        setNodes(data.nodes ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setInventoryError(err instanceof Error ? err.message : "Inventory failed.");
        }
      })
      .finally(() => {
        if (!cancelled) setInventoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  async function prepareAutomaticPlan() {
    if (!scanId) return;
    setAnalyzing(true);
    invalidateQuoteAndPreview();
    try {
      const res = await fetch("/api/user-directed/prepare-cleanup-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scanId,
          repository,
          pinnedCommit,
          excludeFindingIds: excludedFindingIds,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        transformationPlans?: TransformationPlan[];
        summary?: typeof planSummary;
        includedFindingIds?: string[];
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Prepare cleanup plan failed.");
      }
      setPlans(data.transformationPlans ?? []);
      setPlanSummary(data.summary ?? null);
      if (data.includedFindingIds?.length) {
        setSelectedFindingIds(data.includedFindingIds);
      }
      setScopeReviewed(true);
      setStage("plan");
      setPlanOpen((s) => ({ ...s, selected: true, patch: true }));
    } catch (err) {
      setPlans([]);
      setPreviewError(err instanceof Error ? err.message : "Prepare failed.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function analyzeScope(input: {
    actionType: RequestedActionType;
    userInstruction: string;
    canonicalPath?: string;
  }) {
    setAnalyzing(true);
    setLastActionType(input.actionType);
    setLastInstruction(input.userInstruction);
    setLastCanonical(input.canonicalPath);
    invalidateQuoteAndPreview();
    try {
      const res = await fetch("/api/user-directed/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repository,
          pinnedCommit,
          scanId,
          selectedRepositoryPaths: selectedPaths,
          selectedFindingIds,
          actionType: input.actionType,
          userInstruction: input.userInstruction || undefined,
          canonicalPath: input.canonicalPath,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        transformationPlans?: TransformationPlan[];
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Analyze failed.");
      }
      setPlans(data.transformationPlans ?? []);
      setScopeReviewed(true);
      setStage("plan");
    } catch (err) {
      setPlans([]);
      setPreviewError(err instanceof Error ? err.message : "Analyze failed.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function generatePreview() {
    if (!scanId) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setQuote(null);
    try {
      const res = await fetch("/api/user-directed/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scanId,
          repository,
          pinnedCommit,
          selectedRepositoryPaths: selectedPaths,
          selectedFindingIds,
          actionType: lastActionType,
          userInstruction: lastInstruction || undefined,
          canonicalPath: lastCanonical,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        preview?: PatchPreviewModel | null;
        transformationPlans?: TransformationPlan[];
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Preflight failed.");
      }
      if (data.transformationPlans?.length) {
        setPlans(data.transformationPlans);
      }
      setPreview(data.preview ?? null);
      if (!data.preview) {
        setPreviewError("No write patch for this action — quote is not available.");
      }
      setPlanOpen((s) => ({ ...s, patch: true }));
    } catch (err) {
      setPreview(null);
      setPreviewError(err instanceof Error ? err.message : "Preflight failed.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function createQuote() {
    const plan = plans.find((p) => p.executable && p.normalizedPatchHash);
    if (!plan) {
      setQuoteError("No executable plan with a real patch hash.");
      return;
    }
    setQuoteLoading(true);
    setQuoteError(null);
    try {
      const paymentChannel = okxOnlyPayment
        ? "okx_a2a_marketplace"
        : channel ?? "direct_website";
      const res = await fetch("/api/user-directed/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, paymentChannel }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        quote?: DynamicSignedQuote;
      };
      if (!res.ok || !data.ok || !data.quote) {
        throw new Error(data.error || "Quote failed.");
      }
      setQuote(data.quote);
      setStage("pay");
    } catch (err) {
      setQuote(null);
      setQuoteError(err instanceof Error ? err.message : "Quote failed.");
    } finally {
      setQuoteLoading(false);
    }
  }

  async function authorizePayment() {
    const effectiveChannel = okxOnlyPayment ? "okx_a2a_marketplace" : channel;
    if (!quote || !effectiveChannel || !executablePlan || !scanId) return;
    setAuthorizing(true);
    setQuoteError(null);
    try {
      const res = await fetch("/api/user-directed/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: executablePlan,
          paymentChannel: effectiveChannel,
          clientAmountAtomic: quote.amountAtomic,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        quote?: DynamicSignedQuote;
      };
      if (!res.ok || !data.ok || !data.quote) {
        throw new Error(data.error || "Quote rebind failed.");
      }
      setQuote(data.quote);

      const repoUrl =
        session.repoUrl ||
        (session.scanResult?.repo
          ? `https://github.com/${session.scanResult.repo.owner}/${session.scanResult.repo.name}`
          : `https://github.com/${repository}`);
      const purchaseChannel =
        effectiveChannel === "okx_a2a_marketplace" ? "okx_marketplace" : "direct_site";
      const { task } = await createWorkflowA2ATask({
        repoUrl,
        branch: session.branch || session.scanResult?.repo?.branch,
        scanId,
        commitSha: pinnedCommit,
        findingIds:
          executablePlan.selectedFindingIds.length > 0
            ? executablePlan.selectedFindingIds
            : selectedFindingIds,
        purchaseChannel,
        dynamicQuoteId: data.quote.quoteId,
        planHash: data.quote.planHash,
        amountMicro: data.quote.amountAtomic,
      });
      setA2aTask(task);
      setStage("delivery");
    } catch (err) {
      setQuoteError(err instanceof Error ? err.message : "Authorization failed.");
    } finally {
      setAuthorizing(false);
    }
  }

  function requestDeeperVerification(plan: TransformationPlan) {
    void analyzeScope({
      actionType: "INSPECT",
      userInstruction: `Deeper verification for plan ${plan.planId}`,
    });
  }

  function requestEditPlan(plan: TransformationPlan) {
    setSelectedPathIds(plan.selectedRepositoryPaths.map((p) => `path_${p}`));
    setMode("ADVANCED");
    void analyzeScope({
      actionType: "EDIT",
      userInstruction: "Request edit plan from review-first finding",
    });
  }

  function markRetained(plan: TransformationPlan) {
    void analyzeScope({
      actionType: "KEEP",
      userInstruction: `Retain ${plan.selectedRepositoryPaths.join(", ")}`,
    });
  }

  function suppressPlan(plan: TransformationPlan) {
    void analyzeScope({
      actionType: "SUPPRESS",
      userInstruction: `Suppress suggestion for ${plan.selectedRepositoryPaths.join(", ")}`,
    });
  }

  function toggleExclude(findingId: string) {
    setExcludedFindingIds((ids) =>
      ids.includes(findingId) ? ids.filter((id) => id !== findingId) : [...ids, findingId]
    );
    invalidateQuoteAndPreview();
  }

  return (
    <div className="space-y-4" data-user-directed-workbench data-session-source={sessionSource}>
      <nav
        className="flex flex-wrap gap-1 rounded-md border border-border/40 bg-card/20 p-1"
        aria-label="Product workflow stages"
        data-stage-count="4"
      >
        {WORKBENCH_STAGES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setStage(t.id)}
            className={`rounded px-3 py-1.5 text-sm ${
              stage === t.id
                ? "bg-electric/15 text-electric"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-current={stage === t.id ? "page" : undefined}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {okxOnlyPayment ? (
        <p className="rounded-md border border-border/40 bg-card/20 px-3 py-2 text-xs text-muted-foreground">
          OKX session — payment uses official OKX escrow only. Direct website payment is hidden.
          {searchParams.get("okxJobId") || searchParams.get("jobId")
            ? ` Job ${searchParams.get("okxJobId") || searchParams.get("jobId")}.`
            : null}
        </p>
      ) : null}

      {stage === "review" ? (
        <section className="space-y-4" aria-label="Review">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["AUTOMATIC_CLEANUP", "Automatic Cleanup"],
                ["GUIDED_REVIEW", "Guided Review"],
                ["ADVANCED", "Advanced"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                className={`rounded-md border px-3 py-1.5 text-xs ${
                  mode === id
                    ? "border-electric/50 bg-electric/10 text-electric"
                    : "border-border/50 text-muted-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "AUTOMATIC_CLEANUP" ? (
            <section className="space-y-4 rounded-md border border-border/50 bg-card/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Automatic Cleanup
              </p>
              <h2 className="text-lg font-semibold">RepoDiet found</h2>
              <ul className="grid gap-2 text-sm sm:grid-cols-2">
                <li>{outcome.safeRemovals} files safe to remove</li>
                <li>{outcome.duplicateConsolidations} duplicate group to consolidate</li>
                <li>{outcome.referencesToUpdate} references requiring updates</li>
                <li>{outcome.itemsNeedingDecision} items needing your decision</li>
                <li>{outcome.protectedPaths} protected paths untouched</li>
              </ul>
              <div className="rounded-md border border-border/40 bg-background/40 p-3 text-sm">
                <p className="font-medium">Estimated result</p>
                <p className="mt-1 text-muted-foreground">
                  {outcome.predictedFilesChanged} files changed · {outcome.predictedLinesRemoved}{" "}
                  lines removed · No protected files touched
                </p>
              </div>

              <div className="space-y-2">
                {eligibleFindings.slice(0, 12).map((f) => {
                  const action = recommendedActionForFinding(f);
                  const included = !excludedFindingIds.includes(f.id);
                  return (
                    <article
                      key={f.id}
                      className="rounded-md border border-border/40 bg-background/30 p-3 text-sm"
                    >
                      <p className="font-medium">{outcomeLabelForFinding(f)}</p>
                      <p className="mt-0.5">
                        <code className="text-xs">{f.files[0] ?? f.title}</code>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{plainLanguageWhy(f)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Result: {resultLabelForAction(action, f.files.length || 1)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded border border-border/50 px-2 py-1 text-xs"
                          onClick={() => toggleExclude(f.id)}
                        >
                          {included ? "Exclude from cleanup" : "Include in cleanup"}
                        </button>
                        <details className="text-xs text-muted-foreground">
                          <summary className="cursor-pointer">View evidence</summary>
                          <ul className="mt-1 list-disc pl-4">
                            {(f.evidence.signals ?? []).slice(0, 6).map((s) => (
                              <li key={s}>{s}</li>
                            ))}
                          </ul>
                        </details>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md bg-electric px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
                  disabled={analyzing || !scanId}
                  onClick={() => void prepareAutomaticPlan()}
                >
                  {analyzing ? "Preparing…" : "Prepare cleanup plan"}
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border/50 px-3 py-1.5 text-sm"
                  onClick={() => setMode("GUIDED_REVIEW")}
                >
                  Review uncertain items
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border/50 px-3 py-1.5 text-sm"
                  onClick={() => setMode("ADVANCED")}
                >
                  Advanced repository explorer
                </button>
              </div>
              {previewError ? <p className="text-sm text-destructive">{previewError}</p> : null}
            </section>
          ) : null}

          {mode === "GUIDED_REVIEW" ? (
            <section className="space-y-4 rounded-md border border-border/50 bg-card/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Guided Review</p>
              <h2 className="text-lg font-semibold">Items needing your decision</h2>
              {reviewFindings.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No uncertain findings — you can prepare the automatic cleanup plan.
                </p>
              ) : (
                reviewFindings.slice(0, 20).map((f) => {
                  const prompt = buildGuidedReviewPrompt(f);
                  return (
                    <article
                      key={f.id}
                      className="space-y-2 rounded-md border border-border/40 bg-background/30 p-3 text-sm"
                    >
                      <p className="font-medium">{prompt.question}</p>
                      {prompt.blockerDetail ? (
                        <p className="text-xs text-muted-foreground">{prompt.blockerDetail}</p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        {prompt.choices.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="rounded border border-border/50 px-2 py-1 text-xs"
                            onClick={() => {
                              if (c.id === "yes_keep") {
                                void analyzeScope({
                                  actionType: "KEEP",
                                  userInstruction: `Keep ${prompt.path} intentionally`,
                                });
                              } else if (c.id === "no_verify_deletion") {
                                setSelectedPathIds(
                                  (f.files ?? []).map((p) => `path_${p}`)
                                );
                                void analyzeScope({
                                  actionType: "INSPECT",
                                  userInstruction: `Verify deletion for ${prompt.path}`,
                                });
                              }
                            }}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </article>
                  );
                })
              )}
              <button
                type="button"
                className="rounded-md border border-border/50 px-3 py-1.5 text-sm"
                onClick={() => setMode("AUTOMATIC_CLEANUP")}
              >
                Back to Automatic Cleanup
              </button>
            </section>
          ) : null}

          {mode === "ADVANCED" ? (
            <div className="space-y-4">
              <RepositoryExplorer
                nodes={nodes}
                selectedPathIds={selectedPathIds}
                onSelectionChange={onSelectionChange}
                loading={inventoryLoading}
                error={inventoryError}
              />
              <SelectedWorkPanel
                repository={repository}
                pinnedCommit={pinnedCommit}
                selectedPathIds={selectedPathIds}
                selectedPaths={selectedPaths}
                selectedFindingIds={selectedFindingIds}
                analyzing={analyzing}
                plans={plans}
                onAnalyze={analyzeScope}
                onClearSelection={() => onSelectionChange([])}
                progressiveDisclosure
                findings={flatFindings}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      {stage === "plan" ? (
        <section className="space-y-3" aria-label="Plan">
          {planSummary ? (
            <div className="rounded-md border border-border/50 bg-card/30 p-4 text-sm">
              <p className="font-medium">Combined cleanup plan</p>
              <p className="mt-1 text-muted-foreground">
                Delete {planSummary.deleteCount} · consolidate {planSummary.consolidateCount} ·
                update refs {planSummary.referenceUpdateCount} · edits {planSummary.editCount}
              </p>
            </div>
          ) : null}

          <Expandable
            title="Selected work"
            open={planOpen.selected}
            onToggle={() => setPlanOpen((s) => ({ ...s, selected: !s.selected }))}
          >
            <ChangePlanPanel
              plans={plans}
              onRequestDeeperVerification={requestDeeperVerification}
              onRequestEditPlan={requestEditPlan}
              onMarkRetained={markRetained}
              onSuppress={suppressPlan}
            />
          </Expandable>

          <Expandable
            title="Exact patch"
            open={planOpen.patch}
            onToggle={() => setPlanOpen((s) => ({ ...s, patch: !s.patch }))}
          >
            <PatchPreviewPanel
              plans={plans}
              preview={preview}
              loading={previewLoading}
              error={previewError}
              onGeneratePreview={generatePreview}
            />
          </Expandable>

          <Expandable
            title="Evidence"
            open={planOpen.evidence}
            onToggle={() => setPlanOpen((s) => ({ ...s, evidence: !s.evidence }))}
          >
            <ul className="space-y-2 text-sm text-muted-foreground">
              {plans.flatMap((p) =>
                p.evidence.slice(0, 4).map((e, i) => (
                  <li key={`${p.planId}-${i}`}>
                    [{e.kind}] {e.detail}
                  </li>
                ))
              )}
              {plans.length === 0 ? <li>Prepare a cleanup plan to see evidence.</li> : null}
            </ul>
          </Expandable>

          <Expandable
            title="Validation"
            open={planOpen.validation}
            onToggle={() => setPlanOpen((s) => ({ ...s, validation: !s.validation }))}
          >
            <ul className="text-sm">
              {(
                preview?.validationCommands ??
                planSummary?.validationCommands ??
                executablePlan?.validationCommands ??
                []
              ).map((c) => (
                <li key={c}>
                  <code>{c}</code>
                </li>
              ))}
            </ul>
          </Expandable>

          <Expandable
            title="Rollback"
            open={planOpen.rollback}
            onToggle={() => setPlanOpen((s) => ({ ...s, rollback: !s.rollback }))}
          >
            <p className="text-sm text-muted-foreground">
              {preview?.rollbackPlan ??
                executablePlan?.rollbackPlan ??
                "Close or revert the delivery PR to restore the pinned commit."}
            </p>
          </Expandable>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md bg-electric px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
              disabled={!executablePlan && !preview}
              onClick={() => {
                if (!preview) void generatePreview();
                else void createQuote();
              }}
            >
              Continue to Pay
            </button>
            <button
              type="button"
              className="rounded-md border border-border/50 px-3 py-1.5 text-sm"
              onClick={() => setStage("review")}
            >
              Back to Review
            </button>
          </div>
        </section>
      ) : null}

      {stage === "pay" ? (
        <QuotePaymentPanel
          quote={quote}
          loading={quoteLoading}
          error={quoteError}
          channel={okxOnlyPayment ? "okx_a2a_marketplace" : channel}
          onChannelChange={(c) => {
            if (okxOnlyPayment) return;
            setChannel(c);
            setQuote(null);
          }}
          onCreateQuote={createQuote}
          onAuthorize={authorizePayment}
          authorizing={authorizing}
          canQuote={Boolean(executablePlan)}
          hideDirectPayment={okxOnlyPayment}
          sessionSource={sessionSource}
        />
      ) : null}

      {stage === "delivery" ? <VerifyTab /> : null}
    </div>
  );
}

function Expandable({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border/50 bg-card/20">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
        onClick={onToggle}
        aria-expanded={open}
      >
        {title}
        <span className="text-muted-foreground">{open ? "−" : "+"}</span>
      </button>
      {open ? <div className="border-t border-border/40 p-3">{children}</div> : null}
    </div>
  );
}
