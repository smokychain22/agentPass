import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getCanonicalOkxIdentity } from "@/lib/okx/identity";
import { OKX_A2A_PUBLIC_OPERATION } from "@/lib/okx/services";
import { resolvePlanReadiness } from "@/lib/user-directed/plan-readiness";
import {
  computeDecisionsFingerprint,
  listFindingDecisions,
} from "@/lib/user-directed/decision-store";
import { getStoredFindings } from "@/lib/findings/findings-store";
import { flattenFindings } from "@/lib/findings/client";
import { riskBucketOf } from "@/lib/findings/cleanup-eligibility";
import { getAgentRuntimeHealth } from "@/lib/a2a/agent-runtime-health";
import { resolveAuthoritativeRepositoryAccess } from "@/lib/github-app/authoritative-repository-access";
import { isRepositoryVerifiedState } from "@/lib/github-app/authoritative-access";
import { parseGitHubUrl } from "@/lib/github/parse-github-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const A2A_AMOUNT_LABEL = "1 USD₮0";

function buyerAgentId(): string {
  return (
    process.env.REPODIET_OKX_BUYER_AGENT_ID?.trim() ||
    process.env.OKX_BUYER_AGENT_ID?.trim() ||
    "5295"
  );
}

/**
 * Side-effect-free preflight for one controlled A2A cleanup task.
 *
 * This endpoint answers a single question: "if the user confirmed right
 * now, would funding be safe and correct?" It performs NO mutation — no
 * task, no escrow, no branch, no commit, no pull request, no delivery, and
 * no marketplace change. Every blocker is reported explicitly so the UI can
 * name the exact gap instead of failing silently.
 *
 * Funding must remain disabled unless this returns ok: true.
 */
export async function POST(request: Request) {
  const blockers: string[] = [];
  const verifiedAt = new Date().toISOString();

  let body: { scanId?: string; repositoryUrl?: string };
  try {
    body = (await request.json()) as { scanId?: string; repositoryUrl?: string };
  } catch {
    return NextResponse.json(
      { ok: false, blockers: ["Request body must be valid JSON."], verifiedAt },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!body.scanId) {
    return NextResponse.json(
      { ok: false, blockers: ["scanId is required."], verifiedAt },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const identity = getCanonicalOkxIdentity();
  const sellerAgentId = String(identity.aspAgentId);
  const serviceId = String(identity.a2aServiceId);
  const operation = OKX_A2A_PUBLIC_OPERATION;

  // Routing must be the A2A service, never the A2MCP one.
  if (serviceId === String(identity.a2mcpServiceId)) {
    blockers.push(
      `A2A routing resolved to the A2MCP service ${identity.a2mcpServiceId}; it must resolve to the A2A service.`
    );
  }
  if (operation !== "create_cleanup_pr") {
    blockers.push(`Operation resolved to "${operation}", expected create_cleanup_pr.`);
  }

  // --- Scan, findings, decisions, plan (persisted backend truth) --------

  const findingsPayload = await getStoredFindings(body.scanId);
  if (!findingsPayload) {
    return NextResponse.json(
      {
        ok: false,
        blockers: ["No stored findings for this scanId — the scan is stale or unknown."],
        sellerAgentId,
        buyerAgentId: buyerAgentId(),
        serviceId,
        operation,
        verifiedAt,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }

  const repository = `${findingsPayload.repo.owner}/${findingsPayload.repo.name}`;
  const branch = findingsPayload.repo.branch;
  // One shared authoritative selector — identical to what the nav and the
  // patch-route guard use, so preflight can never disagree with them.
  const readiness = await resolvePlanReadiness({ scanId: body.scanId });
  const pinnedCommit = readiness.pinnedCommit;
  const decisionFingerprint = readiness.decisionFingerprint;
  const plan = readiness.plan;
  if (!pinnedCommit) blockers.push("No pinned commit could be resolved for this scan or plan.");

  const decisions = await listFindingDecisions(body.scanId);

  const selectedDecisions = decisions.filter(
    (d) => d.decision === "selected" || d.decision === "verified_selected"
  );
  const selectedFindingIds = selectedDecisions.map((d) => d.findingId);
  const selectedCount = selectedFindingIds.length;

  if (!readiness.approved) {
    blockers.push(readiness.blockerReason ?? "No approved cleanup plan exists for this scan.");
  } else if (!readiness.current) {
    blockers.push(readiness.blockerReason ?? "The approved cleanup plan is no longer current.");
  }

  // Selected set must agree with the approved plan exactly.
  if (plan?.status === "approved") {
    const planIds = [...plan.includedFindingIds].sort();
    const liveIds = [...selectedFindingIds].sort();
    if (planIds.length !== liveIds.length || planIds.some((id, i) => id !== liveIds[i])) {
      blockers.push("Selected findings do not match the approved plan's finding IDs.");
    }
  }
  if (selectedCount < 1) blockers.push("At least one selected cleanup action is required.");

  // Every selected finding must exist, be supported, and be safe to touch.
  const byId = new Map(flattenFindings(findingsPayload).map((f) => [f.id, f]));
  const transformations: string[] = [];
  const affectedFiles = new Set<string>();
  for (const id of selectedFindingIds) {
    const finding = byId.get(id);
    if (!finding) {
      blockers.push(`Selected finding ${id} is not present in the stored scan.`);
      continue;
    }
    if (riskBucketOf(finding) === "PROTECTED") {
      blockers.push(`Selected finding ${id} is protected and must not enter the plan.`);
    }
    if (finding.detectionType && !finding.supportedTransformationId) {
      blockers.push(
        `Selected finding ${id} is informational — RepoDiet has no implemented transformation for it.`
      );
    }
    if (finding.supportedTransformationId) transformations.push(finding.supportedTransformationId);
    for (const file of finding.files) affectedFiles.add(file);
  }

  // --- GitHub write capability -----------------------------------------

  const repoUrl = findingsPayload.repo.url || `https://github.com/${repository}`;
  const parsed = parseGitHubUrl(repoUrl);
  let githubCapabilities = {
    installationFound: false,
    repositorySelected: false,
    canReadRepository: false,
    canCreateBranch: false,
    canPushChanges: false,
    canCreatePullRequest: false,
    canReadChecks: false,
  };
  if (!parsed) {
    blockers.push("The scan's repository URL is not a valid GitHub URL.");
  } else {
    const access = await resolveAuthoritativeRepositoryAccess({
      owner: parsed.owner,
      repo: parsed.repo,
    });
    const verified =
      isRepositoryVerifiedState(access.authoritativeState) &&
      access.installationFound &&
      access.repositorySelected &&
      access.installationTokenAvailable;
    const contentsWrite = access.contentsPermission === "write";
    const prWrite = access.pullRequestsPermission === "write";
    githubCapabilities = {
      installationFound: access.installationFound,
      repositorySelected: access.repositorySelected,
      canReadRepository: verified,
      canCreateBranch: verified && contentsWrite,
      canPushChanges: verified && contentsWrite,
      canCreatePullRequest: verified && contentsWrite && prWrite,
      canReadChecks: verified,
    };
    if (!githubCapabilities.canCreatePullRequest) {
      blockers.push(
        access.diagnosticReason ??
          "GitHub write access is not verified for this repository (branch/push/pull-request permission missing)."
      );
    }
  }

  // --- Seller runtime ---------------------------------------------------

  const health = await getAgentRuntimeHealth();
  const runtimeHealth = {
    agentOnline: Boolean(health.agentOnline),
    heartbeatStatus: health.heartbeatStatus,
    officialWatchActive: Boolean(health.officialWatchActive),
    xmtpClientReady: Boolean(health.xmtpClientReady),
    lastSeenAt: health.lastSeenAt,
  };
  if (!runtimeHealth.agentOnline) {
    blockers.push(`Seller Agent ${sellerAgentId} is not online — it cannot acknowledge a task.`);
  }
  if (runtimeHealth.heartbeatStatus !== "fresh") {
    blockers.push(`Seller runtime heartbeat is "${runtimeHealth.heartbeatStatus}", expected fresh.`);
  }

  // --- Idempotency ------------------------------------------------------

  const idempotencyKey = createHash("sha256")
    .update(
      [
        buyerAgentId(),
        sellerAgentId,
        serviceId,
        operation,
        repository,
        branch,
        pinnedCommit,
        plan?.status === "approved" ? body.scanId : "no_plan",
        decisionFingerprint,
        A2A_AMOUNT_LABEL,
      ].join("|")
    )
    .digest("hex")
    .slice(0, 32);

  return NextResponse.json(
    {
      ok: blockers.length === 0,
      blockers,
      sellerAgentId,
      buyerAgentId: buyerAgentId(),
      serviceId,
      serviceUuid: process.env.REPODIET_OKX_A2A_SERVICE_UUID?.trim() || undefined,
      operation,
      repository,
      branch,
      pinnedCommit,
      planId: plan?.status === "approved" ? body.scanId : undefined,
      planStatus: plan?.status ?? "not_created",
      decisionFingerprint,
      selectedFindingIds,
      selectedCount,
      approvedPlanCount: plan?.includedFindingIds.length ?? 0,
      transformations,
      affectedFiles: [...affectedFiles],
      githubCapabilities,
      runtimeHealth,
      // No task lookup mutation — reported as unknown until the official
      // task-lifecycle work lands; funding stays gated on ok:true anyway.
      existingTask: null,
      idempotencyKey,
      amount: A2A_AMOUNT_LABEL,
      verifiedAt,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
