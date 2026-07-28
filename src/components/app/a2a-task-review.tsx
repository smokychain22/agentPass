"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAppSession } from "@/components/app/app-session";

/**
 * Create Cleanup PR — the dedicated tab=patch experience.
 *
 * This replaces mounting <UserDirectedWorkbench initialStage="pay" />, whose
 * payment path required an invisible first click (generatePreview) before a
 * second click could reach createQuote, posted to /api/user-directed/quote
 * rather than the official A2A service, rendered its errors in a different
 * stage where they were invisible, and depended on client-only `plans` state
 * that is empty after any refresh.
 *
 * Everything shown here comes from POST /api/a2a/preflight — persisted
 * backend truth only. Opening or refreshing the review is free and
 * side-effect-free: no task, escrow, branch, commit, pull request, or
 * marketplace change.
 */

interface ExistingTask {
  lookupCompleted?: boolean;
  found?: boolean;
  taskId?: string;
  state?: string;
  terminal?: boolean;
  escrowId?: string;
  deliveryId?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface PreflightResult {
  ok?: boolean;
  blockers?: string[];
  sellerAgentId?: string;
  buyerAgentId?: string;
  serviceId?: string;
  operation?: string;
  repository?: string;
  branch?: string;
  pinnedCommit?: string;
  planId?: string;
  planStatus?: string;
  decisionFingerprint?: string;
  selectedFindingIds?: string[];
  selectedCount?: number;
  approvedPlanCount?: number;
  transformations?: string[];
  affectedFiles?: string[];
  githubCapabilities?: Record<string, boolean>;
  runtimeHealth?: Record<string, unknown>;
  existingTask?: ExistingTask | null;
  idempotencyKey?: string;
  amount?: string;
  verifiedAt?: string;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-border/30 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono text-xs break-all">{value}</dd>
    </div>
  );
}

function Capability({ label, ok }: { label: string; ok: boolean }) {
  return (
    <li className={ok ? "text-signal" : "text-destructive"}>
      {ok ? "✓" : "✗"} {label}
    </li>
  );
}

export function A2ATaskReview() {
  const searchParams = useSearchParams();
  const { session, findings } = useAppSession();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PreflightResult | null>(null);

  // Canonical scan: URL first (it survives navigation and refresh), then
  // authoritative session state. Never client-only workbench state.
  const scanId =
    searchParams.get("scanId")?.trim() || findings?.scanId || session.scanRecordId || "";

  const runPreflight = useCallback(async () => {
    if (!scanId) {
      setError("No active scan. Return to Review Findings and approve a cleanup plan.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/a2a/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ scanId }),
      });
      const data = (await res.json()) as PreflightResult;
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Preflight could not be completed.");
    } finally {
      setLoading(false);
    }
  }, [scanId]);

  // A single click opens the review and runs exactly one preflight request.
  useEffect(() => {
    if (open && !result && !loading && !error) void runPreflight();
  }, [open, result, loading, error, runPreflight]);

  const gh = result?.githubCapabilities ?? {};
  const rt = (result?.runtimeHealth ?? {}) as Record<string, unknown>;
  const existing = result?.existingTask;
  const fundingAllowed = Boolean(result?.ok);

  if (!open) {
    return (
      <section className="space-y-3 rounded-md border border-border/50 bg-card/30 p-4 text-sm">
        <p className="font-medium">Create cleanup pull request</p>
        <p className="text-xs text-muted-foreground">
          RepoDiet delivers a tested, merge-ready pull request. If RepoDiet&apos;s own changes
          fail validation, RepoDiet corrects the delivery without another charge.
        </p>
        <button
          type="button"
          className="rounded-md bg-electric px-3 py-1.5 text-sm font-medium text-background"
          onClick={() => setOpen(true)}
        >
          Review 1 USD₮0 A2A task
        </button>
        <p className="text-xs text-muted-foreground">
          Opening the review is free and creates no task, escrow, branch or pull request.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-md border border-border/50 bg-card/30 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Review 1 USD₮0 A2A task</p>
        {result?.verifiedAt ? (
          <span className="text-xs text-muted-foreground">
            Verified {new Date(result.verifiedAt).toLocaleString()}
          </span>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Running free preflight…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : result ? (
        <>
          <dl className="text-xs">
            <Row label="Provider" value={`RepoDiet Agent ${result.sellerAgentId ?? "—"}`} />
            <Row label="Buyer" value={`User Agent ${result.buyerAgentId ?? "—"}`} />
            <Row label="Service" value={result.serviceId ?? "—"} />
            <Row label="Operation" value={result.operation ?? "—"} />
            <Row label="Repository" value={result.repository ?? "—"} />
            <Row label="Branch" value={result.branch ?? "—"} />
            <Row label="Pinned commit" value={result.pinnedCommit || "—"} />
            <Row label="Approved plan" value={result.planId ?? result.planStatus ?? "—"} />
            <Row
              label="Selected fixes"
              value={`${result.selectedCount ?? 0} (approved: ${result.approvedPlanCount ?? 0})`}
            />
            <Row
              label="Finding IDs"
              value={result.selectedFindingIds?.join(", ") || "—"}
            />
            <Row label="Transformations" value={result.transformations?.join(", ") || "—"} />
            <Row label="Affected files" value={result.affectedFiles?.join(", ") || "—"} />
            <Row label="Deliverable" value="One tested GitHub pull request" />
            <Row label="Price" value={result.amount ?? "1 USD₮0"} />
            <Row label="Escrow" value="Released only after accepted delivery" />
            <Row label="Decision fingerprint" value={result.decisionFingerprint ?? "—"} />
            <Row label="Idempotency key" value={result.idempotencyKey ?? "—"} />
          </dl>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium">GitHub</p>
              <ul className="mt-1 space-y-0.5 text-xs">
                <Capability label="Installation found" ok={Boolean(gh.installationFound)} />
                <Capability label="Repository selected" ok={Boolean(gh.repositorySelected)} />
                <Capability label="Repository readable" ok={Boolean(gh.canReadRepository)} />
                <Capability label="Branch creation" ok={Boolean(gh.canCreateBranch)} />
                <Capability label="Push access" ok={Boolean(gh.canPushChanges)} />
                <Capability label="Pull-request creation" ok={Boolean(gh.canCreatePullRequest)} />
                <Capability label="Checks readable" ok={Boolean(gh.canReadChecks)} />
              </ul>
            </div>
            <div>
              <p className="text-xs font-medium">RepoDiet runtime</p>
              <ul className="mt-1 space-y-0.5 text-xs">
                <Capability label="Agent online" ok={Boolean(rt.agentOnline)} />
                <Capability label="Official watcher" ok={Boolean(rt.officialWatchActive)} />
                <Capability label="XMTP ready" ok={Boolean(rt.xmtpClientReady)} />
                <Capability
                  label={`Heartbeat ${String(rt.heartbeatStatus ?? "unknown")}`}
                  ok={rt.heartbeatStatus === "fresh"}
                />
              </ul>
              {typeof rt.lastSeenAt === "string" ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Last heartbeat {new Date(rt.lastSeenAt).toLocaleString()}
                </p>
              ) : null}
            </div>
          </div>

          <div className="rounded border border-border/40 bg-background/30 p-2 text-xs">
            <p className="font-medium">Existing task</p>
            {!existing || existing.lookupCompleted === false ? (
              <p className="text-destructive">
                Duplicate-task status could not be determined — funding is blocked.
              </p>
            ) : existing.found ? (
              <p className="text-destructive">
                Active task {existing.taskId} ({existing.state}) already covers this work.
              </p>
            ) : (
              <p className="text-signal">
                ✓ No active task exists for this repository and commit.
              </p>
            )}
          </div>

          {(result.blockers?.length ?? 0) > 0 ? (
            <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs">
              <p className="font-medium text-destructive">
                {result.blockers?.length} blocker
                {result.blockers?.length === 1 ? "" : "s"} must be resolved before funding
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {result.blockers?.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-signal">✓ All free preflight checks passed.</p>
          )}
        </>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-border/50 px-3 py-1.5 text-sm"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
        <button
          type="button"
          className="rounded-md border border-border/50 px-3 py-1.5 text-sm disabled:opacity-50"
          disabled={loading}
          onClick={() => void runPreflight()}
        >
          {loading ? "Checking…" : "Refresh free preflight"}
        </button>
        <button
          type="button"
          className="rounded-md bg-electric px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
          disabled
          title="Funding has not been authorised for this controlled test."
        >
          Confirm and fund 1 USD₮0 escrow
        </button>
        <span className="text-xs text-muted-foreground">
          {fundingAllowed
            ? "Funding has not been authorised for this controlled test."
            : "Funding stays disabled until every preflight check passes."}
        </span>
      </div>
    </section>
  );
}
