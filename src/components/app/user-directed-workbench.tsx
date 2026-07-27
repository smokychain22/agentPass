"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useAppSession } from "@/components/app/app-session";
import { RepositoryExplorer } from "@/components/repository-explorer";
import { ChangePlanPanel } from "@/components/change-plan-panel";
import {
  PatchPreviewPanel,
  type PatchPreviewModel,
} from "@/components/patch-preview-panel";
import { QuotePaymentPanel } from "@/components/quote-payment-panel";
import dynamic from "next/dynamic";
import { pathFromId } from "@/lib/user-directed/path-identity";
import { type WorkbenchStage } from "@/lib/user-directed/product-modes";
import { FindingsAccordion } from "@/components/app/findings/findings-accordion";
import { RepositoryCoveragePanel } from "@/components/app/findings/repository-coverage-panel";
import { RepositoryMap } from "@/components/app/findings/repository-map";
import { AnalyzerSourcesPanel } from "@/components/app/findings/analyzer-sources-panel";
import { ProjectRootPanel } from "@/components/app/findings/project-root-panel";
import { ScanCoveragePanel } from "@/components/app/scan/scan-coverage-panel";
import { outcomeStatusLabel } from "@/lib/user-directed/recommended-action";
import {
  deriveScanFindingsState,
  scanFindingsStateLabel,
  scanFindingsStateHasCounters,
} from "@/lib/findings/scan-state";
import {
  allowsDirectWebsitePayment,
  resolveSessionSource,
  type SessionSource,
} from "@/lib/user-directed/session-source";
import { buildScanOutcomeSummary } from "@/lib/user-directed/scan-outcome-summary";
import { flattenFindingsPayload } from "@/lib/findings/selection";
import { isCleanupEligible } from "@/lib/findings/cleanup-eligibility";
import { outcomeLabelForFinding } from "@/lib/user-directed/recommended-action";
import { plainLanguageWhy } from "@/lib/findings/plain-language";
import { buildFindingCardActions, type FindingCardAction } from "@/lib/user-directed/finding-card-actions";
import type { FindingDecisionRecord } from "@/lib/user-directed/decision-store";
import type { Finding } from "@/lib/findings/types";
import { computeCreateCleanupPrReadiness } from "@/lib/workflow/create-cleanup-pr-readiness";
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
    findingsAnalysisPhase,
    findingsAnalysisProgress,
    findingsAnalysisError,
    retryFindingsAnalysis,
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
  const [resultsView, setResultsView] = useState<"results" | "technical">("results");
  const [resultsFilter, setResultsFilter] = useState("");
  const [resultsStatusFilter, setResultsStatusFilter] = useState<
    "all" | "safe" | "review" | "protected"
  >("all");
  const [nodes, setNodes] = useState<RepositoryPathNode[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [selectedPathIds, setSelectedPathIds] = useState<string[]>([]);
  const [plans, setPlans] = useState<TransformationPlan[]>([]);
  const [decisions, setDecisions] = useState<Record<string, FindingDecisionRecord>>({});
  const [decisionPending, setDecisionPending] = useState<Record<string, boolean>>({});
  const [verifyingFindingIds, setVerifyingFindingIds] = useState<Record<string, boolean>>({});
  const [decisionErrors, setDecisionErrors] = useState<Record<string, string>>({});
  const [planStatus, setPlanStatus] = useState<{
    approved: boolean;
    current: boolean;
    superseded: boolean;
  } | null>(null);
  const [githubCapability, setGithubCapability] = useState<{
    checked: boolean;
    canCreatePullRequest: boolean;
  }>({ checked: false, canCreatePullRequest: false });
  const [githubConnectLoading, setGithubConnectLoading] = useState(false);
  const [githubConnectError, setGithubConnectError] = useState<string | null>(null);
  const [approvingPlan, setApprovingPlan] = useState(false);
  const [approvePlanError, setApprovePlanError] = useState<string | null>(null);
  const [expandedIndividualReview, setExpandedIndividualReview] = useState<Record<string, boolean>>({});
  const [selectedDrawerOpen, setSelectedDrawerOpen] = useState(false);
  const [batchPending, setBatchPending] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
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
  const scanState = useMemo(
    () =>
      deriveScanFindingsState({
        scanComplete: session.scanComplete,
        findings,
        findingsAnalysisPhase,
        findingsAnalysisError,
      }),
    [session.scanComplete, findings, findingsAnalysisPhase, findingsAnalysisError]
  );
  const flatFindings = useMemo(
    () => (findings ? flattenFindingsPayload(findings) : []),
    [findings]
  );
  /**
   * The set the cleanup plan actually gets built from: only findings the
   * user explicitly selected (real persisted decision), restricted to the
   * ones RepoDiet can automatically transform. Unselected/kept/excluded
   * findings never enter this set, no matter how "safe" they are.
   */
  const persistedSelectedEligibleFindings = useMemo(
    () =>
      flatFindings.filter(
        (f) =>
          isCleanupEligible(f) &&
          (decisions[f.id]?.decision === "selected" ||
            decisions[f.id]?.decision === "verified_selected")
      ),
    [flatFindings, decisions]
  );

  const allStatusFindings = useMemo(
    () => flatFindings.map((f) => ({ finding: f, status: outcomeStatusLabel(f) })),
    [flatFindings]
  );

  /**
   * A finding is only "unresolved" (blocks plan approval) when the user
   * genuinely started a cleanup operation on it that is still incomplete
   * (persisted as "verification_requested") — never merely because it is
   * an optional/uncertain finding the user has not touched at all.
   * Untouched review-suggested, protected, and informational findings are
   * never blockers; they simply remain unchanged by default.
   */
  const unresolvedRequiredCount = useMemo(
    () => Object.values(decisions).filter((d) => d.decision === "verification_requested").length,
    [decisions]
  );
  const optionalUncountedCount = useMemo(
    () =>
      allStatusFindings.filter(
        ({ finding, status }) => status === "Review suggested" && !decisions[finding.id]
      ).length,
    [allStatusFindings, decisions]
  );

  // Authoritative selected-fixes count — sourced only from persisted
  // decisions for the active scan/commit, never from client-only checkbox
  // state or Technical Details path selection. Kept/protected/informational
  // findings and stale decisions from another scan never count. Defense in
  // depth: even a stale "selected" decision on a finding whose CURRENT
  // classification is Protected is excluded here — protected findings never
  // count as selected, regardless of what was persisted before.
  const nonSelectableFindingIds = useMemo(
    () =>
      new Set(
        allStatusFindings
          .filter(({ status }) => status === "Protected" || status === "Informational")
          .map(({ finding }) => finding.id)
      ),
    [allStatusFindings]
  );
  const persistedSelectedFindings = useMemo(
    () =>
      Object.values(decisions).filter(
        (d) =>
          (d.decision === "selected" || d.decision === "verified_selected") &&
          !nonSelectableFindingIds.has(d.findingId)
      ),
    [decisions, nonSelectableFindingIds]
  );
  const persistedSelectedCount = persistedSelectedFindings.length;

  // Actively clear (server-side) any stale "selected" decision whose
  // finding is now classified Protected or Informational (no implemented
  // transformation) — e.g. a classifier fix reclassified a previously-
  // selectable file, or Command 3E's detection/resolution split revealed
  // it never had a real transformation. Never just hide it client-side.
  useEffect(() => {
    if (!scanId || nonSelectableFindingIds.size === 0) return;
    for (const [findingId, decision] of Object.entries(decisions)) {
      if (
        nonSelectableFindingIds.has(findingId) &&
        (decision.decision === "selected" || decision.decision === "verified_selected")
      ) {
        void undoDecision(findingId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId, nonSelectableFindingIds, decisions]);

  const persistedOverrideCount = useMemo(
    () => persistedSelectedFindings.filter((d) => d.isOverride).length,
    [persistedSelectedFindings]
  );
  const persistedFilesAffected = useMemo(() => {
    const files = new Set<string>();
    for (const d of persistedSelectedFindings) {
      for (const f of d.filesToRemove ?? []) files.add(f);
    }
    return files.size;
  }, [persistedSelectedFindings]);

  const createCleanupPrReadiness = useMemo(
    () =>
      computeCreateCleanupPrReadiness({
        scanComplete:
          scanState === "complete_with_findings" || scanState === "complete_with_zero_findings",
        findingsReady: Boolean(findings),
        findingsError: scanState === "failed" || scanState === "unavailable",
        analyzedCommit: findings?.repo.commitSha ?? null,
        activeCommit: session.scanResult?.repo?.commitSha ?? null,
        eligibleSelectedCount: persistedSelectedCount,
        unresolvedRequiredCount,
        planApproved: Boolean(planStatus?.approved),
        planCurrent: Boolean(planStatus?.current),
        planSuperseded: Boolean(planStatus?.superseded),
        githubWriteCapable: githubCapability.canCreatePullRequest,
      }),
    [
      scanState,
      findings,
      session.scanResult?.repo?.commitSha,
      persistedSelectedCount,
      unresolvedRequiredCount,
      planStatus,
      githubCapability.canCreatePullRequest,
    ]
  );

  const filteredResults = useMemo(() => {
    const q = resultsFilter.trim().toLowerCase();
    const statusMap: Record<typeof resultsStatusFilter, string | null> = {
      all: null,
      safe: "Recommended fix",
      review: "Review suggested",
      protected: "Protected",
    };
    const wantedStatus = statusMap[resultsStatusFilter];
    return allStatusFindings.filter(({ finding, status }) => {
      if (wantedStatus && status !== wantedStatus) return false;
      if (!q) return true;
      return (
        finding.title.toLowerCase().includes(q) ||
        finding.files.some((f) => f.toLowerCase().includes(q))
      );
    });
  }, [allStatusFindings, resultsFilter, resultsStatusFilter]);

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

  // Decisions must survive refresh, browser restart, and re-navigation — hydrate
  // from durable storage instead of trusting only in-memory state.
  useEffect(() => {
    if (!scanId) return;
    let cancelled = false;
    void fetch(`/api/user-directed/decisions?scanId=${encodeURIComponent(scanId)}`)
      .then((res) => res.json())
      .then((data: { ok?: boolean; decisions?: FindingDecisionRecord[] }) => {
        if (cancelled || !data.ok || !data.decisions) return;
        const byId: Record<string, FindingDecisionRecord> = {};
        for (const d of data.decisions) {
          byId[d.findingId] = d;
        }
        setDecisions(byId);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  // Authoritative — recomputed server-side from the persisted plan and the
  // live decision set every time. Never trust a locally-remembered "approved" flag.
  const refreshPlanStatus = useCallback(async () => {
    if (!scanId) return;
    try {
      const res = await fetch(
        `/api/user-directed/cleanup-plan-status?scanId=${encodeURIComponent(scanId)}&pinnedCommit=${encodeURIComponent(pinnedCommit)}`
      );
      const data = (await res.json()) as {
        ok?: boolean;
        approved?: boolean;
        current?: boolean;
        superseded?: boolean;
      };
      if (!res.ok || !data.ok) {
        setPlanStatus(null);
        return;
      }
      setPlanStatus({
        approved: Boolean(data.approved),
        current: Boolean(data.current),
        superseded: Boolean(data.superseded),
      });
    } catch {
      setPlanStatus(null);
    }
  }, [scanId, pinnedCommit]);

  useEffect(() => {
    void refreshPlanStatus();
  }, [refreshPlanStatus]);

  // Real, repository-scoped production capability check against the
  // authoritative GitHub App installation. Never assume write access from a
  // callback query parameter, a generic "session connected" flag, or cached
  // client state. Deliberately NOT the repository-intake route: that answers
  // as the anonymous read-only tenant (so it can never see an installation)
  // and queues a deep scan as a side effect.
  useEffect(() => {
    if (!repository) return;
    let cancelled = false;
    const installParam = Number(searchParams.get("installation_id"));
    void fetch("/api/github/capability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        repositoryUrl: `https://github.com/${repository}`,
        installationId: Number.isFinite(installParam) && installParam > 0 ? installParam : undefined,
      }),
    })
      .then((res) => res.json())
      .then((data: { ok?: boolean; canCreatePullRequest?: boolean }) => {
        if (cancelled) return;
        setGithubCapability({
          checked: true,
          canCreatePullRequest: Boolean(data.ok && data.canCreatePullRequest),
        });
      })
      .catch(() => {
        if (!cancelled) setGithubCapability({ checked: true, canCreatePullRequest: false });
      });
    return () => {
      cancelled = true;
    };
  }, [repository, searchParams]);

  async function connectGithubForCleanup() {
    if (!repository) return;
    setGithubConnectLoading(true);
    setGithubConnectError(null);
    try {
      const res = await fetch("/api/github/install/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repositoryFullName: repository,
          scanId,
          returnPath: `/app?tab=patch`,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; url?: string; error?: string };
      if (!res.ok || !data.ok || !data.url) {
        throw new Error(data.error || "Could not start the GitHub connection flow.");
      }
      window.location.href = data.url;
    } catch (err) {
      setGithubConnectError(
        err instanceof Error ? err.message : "Could not start the GitHub connection flow."
      );
    } finally {
      setGithubConnectLoading(false);
    }
  }

  async function approveCleanupPlan() {
    if (!scanId || !pinnedCommit) return;
    setApprovingPlan(true);
    setApprovePlanError(null);
    try {
      const res = await fetch("/api/user-directed/approve-cleanup-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scanId,
          pinnedCommit,
          includeFindingIds: persistedSelectedEligibleFindings.map((f) => f.id),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Could not approve the cleanup plan.");
      }
      await refreshPlanStatus();
    } catch (err) {
      setApprovePlanError(
        err instanceof Error ? err.message : "Could not approve the cleanup plan."
      );
    } finally {
      setApprovingPlan(false);
    }
  }

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
          includeFindingIds: persistedSelectedEligibleFindings.map((f) => f.id),
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
      await refreshPlanStatus();
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

  /**
   * Idempotent, and never claims success from client-only state. The
   * confirmed decision, exclusion set, and any dependent plan/analysis calls
   * only proceed once the backend has actually persisted the decision.
   */
  async function recordDecision(finding: Finding, action: FindingCardAction) {
    if (!scanId) return;
    if (decisionPending[finding.id]) return; // one mutation in flight per finding at a time

    if (action.expandsToIndividualFiles) {
      setExpandedIndividualReview((prev) => ({ ...prev, [finding.id]: true }));
      return;
    }

    if (action.triggersVerification) {
      await verifyFinding(finding);
      return;
    }

    if (
      action.requiresConfirmation &&
      !window.confirm(action.confirmationText ?? "Are you sure?")
    ) {
      return;
    }

    setDecisionPending((prev) => ({ ...prev, [finding.id]: true }));
    setDecisionErrors((prev) => {
      if (!(finding.id in prev)) return prev;
      const next = { ...prev };
      delete next[finding.id];
      return next;
    });

    let saved: FindingDecisionRecord | undefined;
    try {
      const res = await fetch("/api/user-directed/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scanId,
          findingId: finding.id,
          decision: action.decision,
          analyzedCommit: pinnedCommit,
          canonicalFile: action.canonicalFile,
          filesToRemove: action.filesToRemove,
          filesToKeep: action.filesToKeep,
          isOverride: action.isOverride,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        decision?: FindingDecisionRecord;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.decision) {
        throw new Error(data.error || "This decision was not saved. Try again.");
      }
      saved = data.decision;
    } catch {
      // Persistence failed: do not touch the confirmed decision, the
      // exclusion set, or any plan/analysis state. Only surface a retryable
      // error for this finding.
      setDecisionPending((prev) => ({ ...prev, [finding.id]: false }));
      setDecisionErrors((prev) => ({
        ...prev,
        [finding.id]: "This decision was not saved. Try again.",
      }));
      return;
    }

    setDecisions((prev) => ({ ...prev, [finding.id]: saved! }));
    setDecisionPending((prev) => ({ ...prev, [finding.id]: false }));
    setPlanStatus(null); // any approved plan may no longer reflect the new decision set

    if (finding.type === "duplicate_code" && action.canonicalFile) {
      setSelectedPathIds((finding.files ?? []).map((p) => `path_${p}`));
      void analyzeScope({
        actionType: "CONSOLIDATE_DUPLICATES",
        canonicalPath: action.canonicalFile,
        userInstruction: `Use ${action.canonicalFile} as the canonical file and remove the rest`,
      });
    } else if (action.id === "remove_anyway") {
      setSelectedPathIds((finding.files ?? []).map((p) => `path_${p}`));
      void analyzeScope({
        actionType: "INSPECT",
        userInstruction: `Verify deletion for ${finding.files[0] ?? finding.title}`,
      });
    }
  }

  /**
   * Runs a real bounded automated verification (Command 3E, Part 3/6): the
   * server re-clones the pinned commit and re-searches for actual static
   * and dynamic references before deciding. Never claims a result the
   * server hasn't confirmed, and never leaves the finding stuck mid-flight
   * — it always resolves to a real final decision.
   */
  async function verifyFinding(finding: Finding) {
    if (!scanId) return;
    if (decisionPending[finding.id]) return;

    setDecisionPending((prev) => ({ ...prev, [finding.id]: true }));
    setVerifyingFindingIds((prev) => ({ ...prev, [finding.id]: true }));
    setDecisionErrors((prev) => {
      if (!(finding.id in prev)) return prev;
      const next = { ...prev };
      delete next[finding.id];
      return next;
    });

    try {
      const res = await fetch("/api/user-directed/verify-finding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId, findingId: finding.id }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        decision?: FindingDecisionRecord;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.decision) {
        throw new Error(data.error || "Verification failed. Try again.");
      }
      setDecisions((prev) => ({ ...prev, [finding.id]: data.decision! }));
      setPlanStatus(null);
    } catch (err) {
      setDecisionErrors((prev) => ({
        ...prev,
        [finding.id]: err instanceof Error ? err.message : "Verification failed. Try again.",
      }));
    } finally {
      setDecisionPending((prev) => ({ ...prev, [finding.id]: false }));
      setVerifyingFindingIds((prev) => ({ ...prev, [finding.id]: false }));
    }
  }

  async function undoDecision(findingId: string) {
    if (!scanId) return;
    await fetch(
      `/api/user-directed/decisions?scanId=${encodeURIComponent(scanId)}&findingId=${encodeURIComponent(findingId)}`,
      { method: "DELETE" }
    ).catch(() => undefined);
    setDecisions((prev) => {
      const next = { ...prev };
      delete next[findingId];
      return next;
    });
    setPlanStatus(null);
  }

  /** Real, backend-backed batch mutation — never claims success the server didn't confirm. */
  async function selectAllRecommended() {
    if (!scanId) return;
    const recommendedCount = flatFindings.filter(
      (f) => isCleanupEligible(f) && !decisions[f.id]
    ).length;
    if (recommendedCount === 0) return;
    if (
      !window.confirm(
        `RepoDiet will select ${recommendedCount} recommended fix(es). Protected and uncertain findings will remain unchanged.`
      )
    ) {
      return;
    }
    setBatchPending(true);
    setBatchError(null);
    try {
      const res = await fetch("/api/user-directed/decisions/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId, action: "select_recommended" }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        outcomes?: Array<{ findingId: string; ok: boolean }>;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Batch selection failed.");
      // Only reflect findings the server actually confirmed — a partial
      // failure never gets shown as a full success.
      const succeededIds = (data.outcomes ?? []).filter((o) => o.ok).map((o) => o.findingId);
      if (succeededIds.length > 0) {
        const fresh = await fetch(`/api/user-directed/decisions?scanId=${encodeURIComponent(scanId)}`);
        const freshData = (await fresh.json()) as { ok?: boolean; decisions?: FindingDecisionRecord[] };
        if (freshData.ok && freshData.decisions) {
          const byId: Record<string, FindingDecisionRecord> = {};
          for (const d of freshData.decisions) byId[d.findingId] = d;
          setDecisions(byId);
        }
      }
      if (!data.ok) {
        setBatchError(
          `${succeededIds.length} of ${data.outcomes?.length ?? 0} selections saved — some failed. Try again for the rest.`
        );
      }
      setPlanStatus(null);
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : "Batch selection failed.");
    } finally {
      setBatchPending(false);
    }
  }

  async function clearSelectedFixes() {
    if (!scanId) return;
    if (persistedSelectedCount === 0) return;
    setBatchPending(true);
    setBatchError(null);
    try {
      const res = await fetch("/api/user-directed/decisions/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId, action: "clear_selected" }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        outcomes?: Array<{ findingId: string; ok: boolean }>;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Clear selection failed.");
      const clearedIds = new Set((data.outcomes ?? []).filter((o) => o.ok).map((o) => o.findingId));
      setDecisions((prev) => {
        const next = { ...prev };
        for (const id of clearedIds) delete next[id];
        return next;
      });
      if (!data.ok) {
        setBatchError("Some selections could not be cleared. Try again.");
      }
      setPlanStatus(null); // an approved plan built from the cleared selections is now stale
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : "Clear selection failed.");
    } finally {
      setBatchPending(false);
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
    setResultsView("technical");
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
    <div className="space-y-4" data-user-directed-workbench data-session-source={sessionSource}>
      {/*
       * No internal Review/Plan/Pay/Delivery tab bar here — the outer app
       * workflow (Analyze Repository → Review Findings → Create Cleanup PR →
       * Review & Accept) already provides that navigation via the sidebar and
       * workflow rail. `stage` still advances the single continuous flow
       * forward as the user takes explicit actions below.
       */}

      {okxOnlyPayment ? (
        <p className="rounded-md border border-border/40 bg-card/20 px-3 py-2 text-xs text-muted-foreground">
          OKX session — payment uses official OKX escrow only. Direct website payment is hidden.
          {searchParams.get("okxJobId") || searchParams.get("jobId")
            ? ` Job ${searchParams.get("okxJobId") || searchParams.get("jobId")}.`
            : null}
        </p>
      ) : null}

      {stage === "review" ? (
        <section className="space-y-4" aria-label="Review Findings">
          <div
            className="flex gap-1 rounded-md border border-border/40 bg-card/20 p-1"
            role="tablist"
            aria-label="Findings view"
          >
            {(
              [
                ["results", "Results"],
                ["technical", "Technical details"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={resultsView === id}
                onClick={() => setResultsView(id)}
                className={`rounded px-3 py-1.5 text-sm ${
                  resultsView === id
                    ? "bg-electric/15 text-electric"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {resultsView === "results" ? (
            <div className="space-y-4" role="tabpanel">
              <div className="rounded-md border border-border/50 bg-card/30 p-4 text-sm">
                <p className="font-mono text-xs text-muted-foreground">
                  {repository || "—"}
                  {session.branch ? ` · branch: ${session.branch}` : ""}
                  {pinnedCommit ? ` · commit: ${pinnedCommit.slice(0, 12)}` : ""}
                </p>
                <p className="mt-2 font-medium">{scanFindingsStateLabel(scanState)}</p>

                {scanFindingsStateHasCounters(scanState) ? (
                  <>
                    <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                      <li>{outcome.safeRemovals} recommended fixes</li>
                      <li>{outcome.itemsNeedingDecision} optional reviews</li>
                      <li>{outcome.protectedPaths} protected</li>
                      <li>{flatFindings.length} findings total</li>
                      <li>
                        Estimated impact: {outcome.predictedFilesChanged} files changed ·{" "}
                        {outcome.predictedLinesRemoved} lines removed
                      </li>
                    </ul>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Unselected findings will remain unchanged.
                    </p>
                    {findings?.scanCoverageWarning ? (
                      <p className="mt-2 text-xs text-amber-400">{findings.scanCoverageWarning}</p>
                    ) : null}
                  </>
                ) : scanState === "failed" || scanState === "unavailable" ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs text-destructive">
                      {findingsAnalysisError?.message ?? "Findings analysis could not complete."}
                    </p>
                    {scanState === "failed" ? (
                      <button
                        type="button"
                        className="rounded border border-border/50 px-2 py-1 text-xs"
                        onClick={retryFindingsAnalysis}
                      >
                        Retry analysis
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    <p>
                      Files discovered:{" "}
                      {findingsAnalysisProgress?.totalUnits ??
                        session.scanResult?.summary?.totalFiles ??
                        "—"}
                    </p>
                    <p>
                      Files classified / analysed so far:{" "}
                      {findingsAnalysisProgress?.completedUnits ?? "—"}
                    </p>
                    <p>
                      Current phase:{" "}
                      {findingsAnalysisProgress?.stage ?? scanFindingsStateLabel(scanState)}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  value={resultsFilter}
                  onChange={(e) => setResultsFilter(e.target.value)}
                  placeholder="Search findings by file or title…"
                  className="min-w-[220px] flex-1 rounded-md border border-border/50 bg-background/40 px-3 py-1.5 text-sm"
                />
                <select
                  value={resultsStatusFilter}
                  onChange={(e) =>
                    setResultsStatusFilter(e.target.value as typeof resultsStatusFilter)
                  }
                  className="rounded-md border border-border/50 bg-background/40 px-2 py-1.5 text-sm"
                >
                  <option value="all">All statuses</option>
                  <option value="safe">Recommended fix</option>
                  <option value="review">Review suggested</option>
                  <option value="protected">Protected</option>
                </select>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/40 bg-card/20 px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  {(() => {
                    const decisionValues = Object.values(decisions);
                    const keptCount = decisionValues.filter(
                      (d) => d.decision === "kept" || d.decision === "verified_kept"
                    ).length;
                    const reviewCount = flatFindings.filter(
                      (f) => outcomeStatusLabel(f) === "Review suggested" && !decisions[f.id]
                    ).length;
                    return `${persistedSelectedCount} fixes selected · ${keptCount} kept · ${reviewCount} needs review`;
                  })()}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded border border-border/50 px-2 py-1 text-xs disabled:opacity-50"
                    disabled={batchPending}
                    onClick={() => void selectAllRecommended()}
                  >
                    Select all recommended fixes
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border/50 px-2 py-1 text-xs disabled:opacity-50"
                    disabled={batchPending || persistedSelectedCount === 0}
                    onClick={() => void clearSelectedFixes()}
                  >
                    Clear selected fixes
                  </button>
                </div>
              </div>
              {batchError ? <p className="text-xs text-destructive">{batchError}</p> : null}

              <div className="space-y-2">
                {filteredResults.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No findings match the current filter.</p>
                ) : (
                  filteredResults.slice(0, 50).map(({ finding: f, status }) => {
                    const cardActions = buildFindingCardActions(f, status);
                    const currentDecision = decisions[f.id];
                    const isSelected =
                      currentDecision?.decision === "selected" ||
                      currentDecision?.decision === "verified_selected";
                    const expandIndividually =
                      status !== "Protected" &&
                      status !== "Informational" &&
                      expandedIndividualReview[f.id] &&
                      f.files.length > 1;

                    return (
                      <article
                        key={f.id}
                        className={`space-y-2 rounded-md border p-3 text-sm ${
                          isSelected
                            ? "border-signal/60 bg-signal/5 ring-1 ring-signal/40"
                            : "border-border/40 bg-background/30"
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="font-medium">
                            {isSelected ? "✓ " : ""}
                            {outcomeLabelForFinding(f)}
                          </p>
                          <span
                            className={`shrink-0 rounded px-2 py-0.5 text-xs ${
                              status === "Recommended fix"
                                ? "bg-signal/15 text-signal"
                                : status === "Review suggested"
                                  ? "bg-amber-400/15 text-amber-400"
                                  : "bg-muted-foreground/15 text-muted-foreground"
                            }`}
                          >
                            {status === "Review suggested" ? "Needs your decision" : status}
                          </span>
                        </div>
                        <p>
                          <code className="text-xs">{f.files.join(", ") || f.title}</code>
                        </p>
                        <p className="text-xs text-muted-foreground">{plainLanguageWhy(f)}</p>

                        {status === "Protected" || status === "Informational" ? (
                          <p className="text-xs font-medium text-muted-foreground">
                            {status === "Protected"
                              ? "RepoDiet will leave this file unchanged."
                              : "RepoDiet will leave this unchanged — no implemented transformation exists for this finding yet."}
                          </p>
                        ) : (
                          <>
                            {decisionPending[f.id] ? (
                              <p className="text-xs text-muted-foreground">
                                {verifyingFindingIds[f.id]
                                  ? "RepoDiet is verifying this automatically…"
                                  : "Saving decision…"}
                              </p>
                            ) : decisionErrors[f.id] ? (
                              <p className="text-xs text-destructive">{decisionErrors[f.id]}</p>
                            ) : currentDecision ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-xs font-medium text-signal">
                                  Selected:{" "}
                                  {currentDecision.canonicalFile
                                    ? `Keep ${currentDecision.canonicalFile.split("/").pop()}, remove ${(
                                        currentDecision.filesToRemove ?? []
                                      )
                                        .map((p) => p.split("/").pop())
                                        .join(", ")}`
                                    : currentDecision.filesToRemove?.length
                                      ? `Remove ${currentDecision.filesToRemove.map((p) => p.split("/").pop()).join(", ")}`
                                      : `Keep ${f.files.map((p) => p.split("/").pop()).join(", ")}`}
                                </p>
                                {currentDecision.isOverride ? (
                                  <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-400">
                                    user override
                                  </span>
                                ) : null}
                                <button
                                  type="button"
                                  className="text-xs text-muted-foreground underline"
                                  onClick={() => void undoDecision(f.id)}
                                >
                                  Undo
                                </button>
                              </div>
                            ) : null}
                            {expandIndividually ? (
                              <div className="space-y-2 border-l-2 border-border/40 pl-3">
                                {f.files.map((path) => {
                                  const singleFileFinding: Finding = { ...f, files: [path] };
                                  const singleActions = buildFindingCardActions(singleFileFinding, status);
                                  return (
                                    <div key={path} className="space-y-1">
                                      <code className="text-xs">{path}</code>
                                      <div className="flex flex-wrap gap-2">
                                        {singleActions
                                          .filter((a) => !a.expandsToIndividualFiles)
                                          .map((a) => (
                                            <button
                                              key={a.id}
                                              type="button"
                                              disabled={Boolean(decisionPending[f.id])}
                                              className="rounded border border-border/50 px-2 py-1 text-xs disabled:opacity-50"
                                              title={a.consequence}
                                              onClick={() => void recordDecision(singleFileFinding, a)}
                                            >
                                              {a.label}
                                            </button>
                                          ))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {cardActions.map((a) => (
                                  <button
                                    key={a.id}
                                    type="button"
                                    disabled={Boolean(decisionPending[f.id])}
                                    className={`rounded border px-2 py-1 text-xs disabled:opacity-50 ${
                                      a.kind === "primary"
                                        ? "border-electric/60 bg-electric/10 font-medium"
                                        : a.kind === "additional"
                                          ? "border-border/30 text-muted-foreground"
                                          : "border-border/50"
                                    } ${currentDecision?.decision === a.decision ? "ring-1 ring-signal" : ""}`}
                                    title={a.consequence}
                                    onClick={() => void recordDecision(f, a)}
                                  >
                                    {currentDecision?.decision === a.decision && a.kind === "primary"
                                      ? "Selected"
                                      : a.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        )}

                        <details className="text-xs text-muted-foreground">
                          <summary className="cursor-pointer">View evidence</summary>
                          <ul className="mt-1 list-disc pl-4">
                            {(f.evidence.signals ?? []).slice(0, 6).map((s) => (
                              <li key={s}>{s}</li>
                            ))}
                          </ul>
                        </details>
                      </article>
                    );
                  })
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md bg-electric px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
                  disabled={analyzing || !scanId || persistedSelectedEligibleFindings.length < 1}
                  title={
                    persistedSelectedEligibleFindings.length < 1
                      ? "Select at least one fix above first."
                      : undefined
                  }
                  onClick={() => void prepareAutomaticPlan()}
                >
                  {analyzing ? "Preparing…" : "Create cleanup plan"}
                </button>
              </div>
              {previewError ? <p className="text-sm text-destructive">{previewError}</p> : null}
            </div>
          ) : (
            <div className="space-y-4" role="tabpanel">
              {/*
               * Technical details is proof of analysis, not a second
               * cleanup-selection workflow — it works as soon as a valid
               * structure scan exists, independent of whether findings
               * analysis has finished or found anything.
               */}
              {session.scanResult ? (
                <FindingsAccordion title="Repository metadata" defaultOpen>
                  <dl className="grid gap-2 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground">Repository</dt>
                      <dd className="font-mono">{repository || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Branch / ref</dt>
                      <dd className="font-mono">{session.scanResult.repo.branch}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Exact commit</dt>
                      <dd className="font-mono">{pinnedCommit || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Scan ID</dt>
                      <dd className="font-mono">{findings?.scanId ?? scanId ?? "—"}</dd>
                    </div>
                  </dl>
                </FindingsAccordion>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Technical details become available once a structure scan has resolved a
                  repository and commit.
                </p>
              )}

              {session.scanResult ? (
                <FindingsAccordion title="Scan coverage" summary="What RepoDiet actually inspected">
                  {findings ? (
                    <RepositoryCoveragePanel coverage={findings.universalCoverage} />
                  ) : (
                    <ScanCoveragePanel
                      scan={session.scanResult}
                      manifest={session.scanResult.intelligenceManifest}
                    />
                  )}
                </FindingsAccordion>
              ) : null}

              {session.scanResult ? (
                <FindingsAccordion title="Repository explorer">
                  <RepositoryExplorer
                    nodes={nodes}
                    selectedPathIds={selectedPathIds}
                    onSelectionChange={onSelectionChange}
                    loading={inventoryLoading}
                    error={inventoryError}
                    readOnly
                  />
                </FindingsAccordion>
              ) : null}

              {session.scanResult ? (
                <FindingsAccordion title="Scan activity" summary="Analyzer sources and detector execution">
                  {findings ? (
                    <AnalyzerSourcesPanel payload={findings} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {scanState === "failed" || scanState === "unavailable"
                        ? "Findings analysis did not complete — no analyzer activity to show."
                        : "Findings analyzers are still running — activity will appear here as they complete."}
                    </p>
                  )}
                </FindingsAccordion>
              ) : null}

              {findings ? (
                <FindingsAccordion title="Repository map">
                  <RepositoryMap findings={flatFindings} />
                </FindingsAccordion>
              ) : null}

              {session.scanResult ? (
                <FindingsAccordion title="Project roots and framework evidence">
                  {findings ? (
                    <ProjectRootPanel payload={findings} />
                  ) : session.scanResult.repositoryModel ? (
                    <div className="space-y-2 text-sm">
                      <p>
                        Primary root:{" "}
                        <span className="font-mono">
                          {session.scanResult.repositoryModel.primaryProjectRoot}
                        </span>
                        {session.scanResult.repositoryModel.monorepoTool
                          ? ` · ${session.scanResult.repositoryModel.monorepoTool} monorepo`
                          : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Framework: {session.scanResult.framework.name}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No project root data yet.</p>
                  )}
                </FindingsAccordion>
              ) : null}
            </div>
          )}
        </section>
      ) : null}

      {stage === "plan" ? (
        <section className="space-y-3" aria-label="Plan">
          <div className="rounded-md border border-electric/40 bg-electric/5 p-4 text-sm space-y-3">
            <p className="font-medium">Cleanup plan</p>
            <dl className="grid gap-1 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Repository</dt>
                <dd className="font-mono">{repository || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Pinned commit</dt>
                <dd className="font-mono">{pinnedCommit ? pinnedCommit.slice(0, 7) : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Selected fixes</dt>
                <dd>{persistedSelectedEligibleFindings.length}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Optional findings unchanged</dt>
                <dd>{optionalUncountedCount}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Protected files unchanged</dt>
                <dd>
                  {allStatusFindings.filter(({ status }) => status === "Protected").length}
                </dd>
              </div>
            </dl>
            {planSummary ? (
              <p className="text-muted-foreground">
                Files expected to change: delete {planSummary.deleteCount} · consolidate{" "}
                {planSummary.consolidateCount} · update refs {planSummary.referenceUpdateCount} ·
                edits {planSummary.editCount}
              </p>
            ) : (
              <p className="text-muted-foreground">
                Prepare the plan below to see exactly which files will change.
              </p>
            )}
            {unresolvedRequiredCount > 0 ? (
              <p className="text-amber-400">
                {unresolvedRequiredCount} selected fix{unresolvedRequiredCount === 1 ? "" : "es"} still
                need{unresolvedRequiredCount === 1 ? "s" : ""} a choice before this plan can be
                approved.
              </p>
            ) : optionalUncountedCount > 0 ? (
              <p className="text-muted-foreground">
                {optionalUncountedCount} optional finding{optionalUncountedCount === 1 ? "" : "s"}{" "}
                will remain unchanged.
              </p>
            ) : null}

            {planStatus?.approved && planStatus.current ? (
              <p className="font-medium text-signal">Cleanup plan approved</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rounded-md bg-electric px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
                  disabled={
                    approvingPlan ||
                    !planSummary ||
                    unresolvedRequiredCount > 0 ||
                    persistedSelectedEligibleFindings.length < 1
                  }
                  onClick={() => void approveCleanupPlan()}
                >
                  {approvingPlan ? "Approving…" : "Approve cleanup plan"}
                </button>
                {planStatus?.approved && !planStatus.current ? (
                  <span className="text-xs text-amber-400">
                    A decision changed since this plan was approved — prepare and approve again.
                  </span>
                ) : null}
                {approvePlanError ? (
                  <span className="text-xs text-destructive">{approvePlanError}</span>
                ) : null}
              </div>
            )}
          </div>

          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Technical details</summary>
            <div className="mt-2 space-y-3">
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
            </div>
          </details>

          {planStatus?.approved && planStatus.current ? (
            <div className="rounded-md border border-border/50 bg-card/30 p-4 text-sm space-y-3">
              <p className="font-medium">Create cleanup pull request</p>
              <dl className="grid gap-1 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Repository</dt>
                  <dd className="font-mono">{repository || "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Branch</dt>
                  <dd className="font-mono">{session.scanResult?.repo?.branch || "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Selected cleanup</dt>
                  <dd>{persistedSelectedEligibleFindings.length} fix(es)</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Tests RepoDiet will run</dt>
                  <dd>
                    {(planSummary?.validationCommands ?? ["npm run typecheck", "npm test"]).join(", ")}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Deliverable</dt>
                  <dd>One tested GitHub pull request</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Price</dt>
                  <dd>1 USD₮0</dd>
                </div>
              </dl>

              <div className="rounded border border-border/40 bg-background/30 px-3 py-2 text-xs">
                <p>
                  GitHub access:{" "}
                  <span
                    className={githubCapability.canCreatePullRequest ? "text-signal" : "text-amber-400"}
                  >
                    {githubCapability.canCreatePullRequest ? "Connected" : "Not connected"}
                  </span>
                </p>
                <p className="mt-1 text-muted-foreground">
                  Repository scope: <span className="font-mono">{repository || "—"}</span>
                </p>
              </div>

              {!githubCapability.canCreatePullRequest ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Connect GitHub to create the pull request</p>
                  <p className="text-xs text-muted-foreground">
                    RepoDiet needs repository-scoped permission to create a branch and open the
                    cleanup pull request.
                  </p>
                  <button
                    type="button"
                    className="rounded-md bg-electric px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
                    disabled={githubConnectLoading}
                    onClick={() => void connectGithubForCleanup()}
                  >
                    {githubConnectLoading ? "Connecting…" : "Connect GitHub"}
                  </button>
                  {githubConnectError ? (
                    <p className="text-xs text-destructive">{githubConnectError}</p>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <div className="w-full rounded border border-border/40 bg-background/20 px-3 py-2 text-xs text-muted-foreground">
                    <p>
                      RepoDiet delivers a tested, merge-ready pull request. If RepoDiet&apos;s own
                      changes fail validation, RepoDiet corrects the delivery without another
                      charge.
                    </p>
                    <p className="mt-1">
                      No extra payment for fixing RepoDiet&apos;s own delivery errors, for a
                      transient retry, or for a replacement pull request required because the
                      original became unusable. A new payment is only ever requested for
                      genuinely expanded scope you explicitly agree to afterward.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded-md bg-electric px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
                    disabled={!createCleanupPrReadiness.unlocked}
                    title={createCleanupPrReadiness.reasons.join(" ")}
                    onClick={() => {
                      if (!preview) void generatePreview();
                      else void createQuote();
                    }}
                  >
                    Approve 1 USD₮0 and create cleanup PR
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-border/50 px-3 py-1.5 text-sm"
                    onClick={() => setStage("review")}
                  >
                    Back to findings
                  </button>
                </div>
              )}
              {!createCleanupPrReadiness.unlocked && githubCapability.canCreatePullRequest ? (
                <ul className="list-disc pl-4 text-xs text-muted-foreground">
                  {createCleanupPrReadiness.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md border border-border/50 px-3 py-1.5 text-sm"
                onClick={() => setStage("review")}
              >
                Back to findings
              </button>
            </div>
          )}
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

      {stage === "review" && persistedSelectedCount > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 px-4 py-3 shadow-lg backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <p className="font-medium">
                {persistedSelectedCount} fix{persistedSelectedCount === 1 ? "" : "es"} selected
                {persistedFilesAffected > 0
                  ? ` · ${persistedFilesAffected} file${persistedFilesAffected === 1 ? "" : "s"} affected`
                  : ""}
              </p>
              {persistedOverrideCount > 0 ? (
                <p className="text-xs text-amber-400">
                  {persistedOverrideCount} risky override{persistedOverrideCount === 1 ? "" : "s"} selected
                </p>
              ) : null}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md border border-border/50 px-3 py-1.5 text-sm"
                onClick={() => setSelectedDrawerOpen(true)}
              >
                View selected fixes
              </button>
              <button
                type="button"
                className="rounded-md bg-electric px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
                disabled={analyzing}
                onClick={() => void prepareAutomaticPlan()}
              >
                {analyzing ? "Preparing…" : `Review cleanup plan (${persistedSelectedCount})`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedDrawerOpen ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40"
          onClick={() => setSelectedDrawerOpen(false)}
        >
          <div
            className="h-full w-full max-w-md overflow-y-auto bg-background p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h2 className="text-lg font-medium">Selected fixes</h2>
              <button
                type="button"
                className="text-sm text-muted-foreground"
                onClick={() => setSelectedDrawerOpen(false)}
              >
                Close
              </button>
            </div>
            <ul className="mt-4 space-y-3">
              {persistedSelectedFindings.length === 0 ? (
                <li className="text-sm text-muted-foreground">No fixes selected yet.</li>
              ) : (
                persistedSelectedFindings.map((d) => {
                  const finding = flatFindings.find((f) => f.id === d.findingId);
                  return (
                    <li key={d.findingId} className="rounded-md border border-border/40 p-3 text-sm">
                      <p className="font-medium">
                        {finding ? outcomeLabelForFinding(finding) : d.findingId}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {d.canonicalFile
                          ? `Keep ${d.canonicalFile} · remove ${(d.filesToRemove ?? []).join(", ")}`
                          : (d.filesToRemove ?? []).join(", ") || "—"}
                      </p>
                      {finding ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Safety: {outcomeStatusLabel(finding)}
                        </p>
                      ) : null}
                      {d.isOverride ? (
                        <p className="mt-1 text-xs text-amber-400">User override of RepoDiet&apos;s recommendation</p>
                      ) : null}
                      <button
                        type="button"
                        className="mt-2 text-xs text-muted-foreground underline"
                        onClick={() => void undoDecision(d.findingId)}
                      >
                        Undo
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </div>
      ) : null}
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
