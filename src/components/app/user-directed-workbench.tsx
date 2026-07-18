"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppSession } from "@/components/app/app-session";
import { RepositoryExplorer } from "@/components/repository-explorer";
import { SelectedWorkPanel } from "@/components/selected-work-panel";
import { ChangePlanPanel } from "@/components/change-plan-panel";
import {
  PatchPreviewPanel,
  type PatchPreviewModel,
} from "@/components/patch-preview-panel";
import { QuotePaymentPanel } from "@/components/quote-payment-panel";
import { FindingsTab } from "@/components/app/findings-tab";
import { VerifyTab } from "@/components/app/verify-tab";
import { pathFromId } from "@/lib/user-directed/path-identity";
import type {
  DynamicSignedQuote,
  PaymentChannelChoice,
  RepositoryPathNode,
  RequestedActionType,
  TransformationPlan,
} from "@/lib/user-directed/types";
import { createWorkflowA2ATask } from "@/lib/workflow/client";

export type ProductWorkbenchTab =
  | "overview"
  | "explorer"
  | "suggestions"
  | "selected"
  | "plan"
  | "patch"
  | "validation"
  | "quote"
  | "delivery";

const TABS: Array<{ id: ProductWorkbenchTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "explorer", label: "Repository Explorer" },
  { id: "suggestions", label: "Suggestions" },
  { id: "selected", label: "Selected Work" },
  { id: "plan", label: "Change Plan" },
  { id: "patch", label: "Patch Preview" },
  { id: "validation", label: "Validation" },
  { id: "quote", label: "Quote & Payment" },
  { id: "delivery", label: "Delivery" },
];

type Props = {
  initialTab?: ProductWorkbenchTab;
};

export function UserDirectedWorkbench({ initialTab = "overview" }: Props) {
  const {
    session,
    findings,
    selectedFindingIds,
    setA2aTask,
    setScopeReviewed,
  } = useAppSession();

  const [tab, setTab] = useState<ProductWorkbenchTab>(initialTab);
  const [nodes, setNodes] = useState<RepositoryPathNode[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [selectedPathIds, setSelectedPathIds] = useState<string[]>([]);
  const [plans, setPlans] = useState<TransformationPlan[]>([]);
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
  const [channel, setChannel] = useState<PaymentChannelChoice | null>(null);
  const [authorizing, setAuthorizing] = useState(false);

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

  const executablePlan = plans.find((p) => p.executable && p.normalizedPatchHash);

  const invalidateQuoteAndPreview = useCallback(() => {
    setPreview(null);
    setQuote(null);
    setQuoteError(null);
    setPreviewError(null);
    setChannel(null);
  }, []);

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
      setTab("plan");
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
        payableQuoteAllowed?: boolean;
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
      setTab("patch");
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
      const paymentChannel = channel ?? "direct_website";
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
      setTab("quote");
    } catch (err) {
      setQuote(null);
      setQuoteError(err instanceof Error ? err.message : "Quote failed.");
    } finally {
      setQuoteLoading(false);
    }
  }

  async function authorizePayment() {
    if (!quote || !channel || !executablePlan || !scanId) return;
    setAuthorizing(true);
    setQuoteError(null);
    try {
      // Re-bind quote to chosen channel
      const res = await fetch("/api/user-directed/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: executablePlan,
          paymentChannel: channel,
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
        channel === "okx_a2a_marketplace" ? "okx_marketplace" : "direct_site";
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
      setTab("delivery");
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
    setTab("selected");
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

  return (
    <div className="space-y-4" data-user-directed-workbench>
      <nav
        className="flex flex-wrap gap-1 rounded-md border border-border/40 bg-card/20 p-1"
        aria-label="Product workflow tabs"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded px-2.5 py-1.5 text-xs ${
              tab === t.id
                ? "bg-electric/15 text-electric"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-current={tab === t.id ? "page" : undefined}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <section className="space-y-3 rounded-md border border-border/50 bg-card/30 p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Overview</p>
          <h2 className="text-lg font-semibold">User-directed repository cleanup</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Select any repository path, then choose what you want RepoDiet to inspect or change.
            RepoDiet suggestions and your explorer selection both feed the same TransformationPlan
            pipeline. Payment only after exact patch review and a dynamic signed quote.
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Browse the pinned Git-tree inventory</li>
            <li>Configure a requested action</li>
            <li>Review the transformation plan and exact patch</li>
            <li>Review validation and the dynamic quote</li>
            <li>Choose Direct website or OKX.AI A2A payment</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md bg-electric px-3 py-1.5 text-sm font-medium text-background"
              onClick={() => setTab("explorer")}
            >
              Open Repository Explorer
            </button>
            <button
              type="button"
              className="rounded-md border border-border/50 px-3 py-1.5 text-sm"
              onClick={() => setTab("suggestions")}
            >
              View Suggestions
            </button>
          </div>
        </section>
      ) : null}

      {tab === "explorer" ? (
        <RepositoryExplorer
          nodes={nodes}
          selectedPathIds={selectedPathIds}
          onSelectionChange={onSelectionChange}
          loading={inventoryLoading}
          error={inventoryError}
        />
      ) : null}

      {tab === "suggestions" ? <FindingsTab /> : null}

      {tab === "selected" ? (
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
        />
      ) : null}

      {tab === "plan" ? (
        <ChangePlanPanel
          plans={plans}
          onRequestDeeperVerification={requestDeeperVerification}
          onRequestEditPlan={requestEditPlan}
          onMarkRetained={markRetained}
          onSuppress={suppressPlan}
        />
      ) : null}

      {tab === "patch" ? (
        <PatchPreviewPanel
          plans={plans}
          preview={preview}
          loading={previewLoading}
          error={previewError}
          onGeneratePreview={generatePreview}
        />
      ) : null}

      {tab === "validation" ? (
        <section className="space-y-3 rounded-md border border-border/50 bg-card/30 p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Validation</p>
          <h2 className="text-lg font-semibold">Validation plan</h2>
          {executablePlan || preview ? (
            <>
              <ul className="text-sm">
                {(preview?.validationCommands ??
                  executablePlan?.validationCommands ??
                  []
                ).map((c) => (
                  <li key={c}>
                    <code>{c}</code>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground">
                Predicted time: ~
                {preview?.predictedValidationSeconds ??
                  executablePlan?.predictedValidationSeconds ??
                  90}
                s
              </p>
              <p className="text-sm text-muted-foreground">
                Unexpected-change budget:{" "}
                {preview?.unexpectedChangeBudget ??
                  executablePlan?.unexpectedChangeBudget ??
                  0}{" "}
                files
              </p>
              <p className="text-sm text-muted-foreground">
                Rollback: {preview?.rollbackPlan ?? executablePlan?.rollbackPlan}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Generate a patch preview to see the exact validation commands for this plan.
            </p>
          )}
        </section>
      ) : null}

      {tab === "quote" ? (
        <QuotePaymentPanel
          quote={quote}
          loading={quoteLoading}
          error={quoteError}
          channel={channel}
          onChannelChange={(c) => {
            setChannel(c);
            setQuote(null);
          }}
          onCreateQuote={createQuote}
          onAuthorize={authorizePayment}
          authorizing={authorizing}
          canQuote={Boolean(executablePlan)}
        />
      ) : null}

      {tab === "delivery" ? <VerifyTab /> : null}
    </div>
  );
}
