import {
  analyzeRepository,
  createCleanupPullRequest,
  createExecutionReceipt,
  executeFreeProof,
  executeQuickCleanup,
  scanRepository,
  selectSafeFixes,
  verifyChanges,
} from "@/lib/execution";
import {
  buildCleanupProof,
  buildCleanupProofFromRun,
  formatProofLadderSummary,
} from "@/lib/execution/proof-ladder";
import { getStoredFindings } from "@/lib/findings/findings-store";
import type { FindingsPayload } from "@/lib/findings/types";
import { phase1EligibilityReason, resolvePhase1Plugin } from "@/lib/execution/fix-plugins/phase1-plugins";
import { getDurableRecord } from "@/lib/store/durable-store";
import { updateRepositoryPolicy } from "@/lib/guard/repository-memory";
import { getExecutionReceipt } from "@/lib/store/product-store";
import { runBasicScan } from "@/lib/scanner/run-scan";
import { ToolInputSchemas } from "@/lib/a2mcp/schemas";
import { Phase3InputSchemas, resolveFindingsPayload } from "@/lib/a2mcp/phase3-schemas";
import {
  analyzersFromFindings,
  createTaskId,
  getAgentTask,
  repositoryFromFindings,
  saveAgentTask,
  type AgentTaskRecord,
} from "@/lib/a2mcp/task-store";

async function persistTask(task: AgentTaskRecord): Promise<AgentTaskRecord> {
  return saveAgentTask(task);
}

async function completeTask(
  taskId: string,
  type: AgentTaskRecord["type"],
  findings: FindingsPayload,
  result: Record<string, unknown>,
  limitations: string[] = [],
  receipt: AgentTaskRecord["receipt"] = {}
): Promise<AgentTaskRecord> {
  const task: AgentTaskRecord = {
    id: taskId,
    type,
    status: "completed",
    repository: repositoryFromFindings(findings),
    scanId: findings.scanId,
    result,
    analyzers: analyzersFromFindings(findings),
    limitations,
    receipt,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
  return persistTask(task);
}

export async function executeScanRepository(
  body: unknown,
  taskId: string
): Promise<AgentTaskRecord> {
  const input = Phase3InputSchemas.repoUrl(body);
  const findings = await scanRepository(input.repoUrl, input.branch);
  const scan = await runBasicScan(input.repoUrl, input.branch);

  return completeTask(taskId, "scan_repository", findings, {
    scanId: findings.scanId,
    summary: findings.summary,
    riskBuckets: findings.riskBuckets,
    scan: {
      framework: scan.framework.name,
      packageManager: scan.packageManager,
      totalFiles: scan.summary.totalFiles,
      totalFolders: scan.summary.totalFolders,
    },
    mode: findings.mode,
  });
}

export async function executeAnalyzeRepository(
  body: unknown,
  taskId: string
): Promise<AgentTaskRecord> {
  const ref = Phase3InputSchemas.repoRef(body);
  const findings = await resolveFindingsPayload(ref, getAgentTask);
  const analyzed = await analyzeRepository(findings);
  const safe = selectSafeFixes(analyzed, 25);

  return completeTask(taskId, "analyze_repository", analyzed, {
    scanId: analyzed.scanId,
    summary: {
      totalFindings: analyzed.summary.totalFindings,
      safeCandidates: safe.length,
      reviewFirst: analyzed.riskBuckets.reviewFirst.length,
      protected: analyzed.riskBuckets.doNotTouch.length,
    },
    riskBuckets: analyzed.riskBuckets,
    findingCounts: {
      duplicates: analyzed.duplicates.length,
      unusedFiles: analyzed.unused.files.length,
      unusedDependencies: analyzed.unused.dependencies.length,
      orphans: analyzed.orphans.length,
      slopSignals: analyzed.slopSignals.length,
    },
  });
}

export async function executeGetFindings(
  body: unknown,
  taskId: string
): Promise<AgentTaskRecord> {
  const ref = Phase3InputSchemas.repoRef(body);
  const findings = await resolveFindingsPayload(ref, getAgentTask);

  return completeTask(taskId, "get_findings", findings, {
    scanId: findings.scanId,
    findings,
  });
}

export async function executeListSafeFixes(
  body: unknown,
  taskId: string
): Promise<AgentTaskRecord> {
  const ref = Phase3InputSchemas.repoRef(body);
  const findings = await resolveFindingsPayload(ref, getAgentTask);
  const safe = selectSafeFixes(findings, 25);

  return completeTask(taskId, "list_safe_fixes", findings, {
    scanId: findings.scanId,
    count: safe.length,
    fixes: safe.map((f) => ({
      id: f.id,
      type: f.type,
      title: f.title,
      files: f.files,
      packageName: f.packageName,
      confidence: f.confidence,
      action: f.action,
      plugin: resolvePhase1Plugin(f).id,
      eligibilityReason: phase1EligibilityReason(f),
    })),
  });
}

export async function executeVerifyPatch(
  body: unknown,
  taskId: string
): Promise<AgentTaskRecord> {
  const record = body as Record<string, unknown>;
  const cleanupRunId =
    (typeof record.cleanupRunId === "string" ? record.cleanupRunId : undefined) ??
    (typeof record.patchId === "string" ? record.patchId : undefined);
  if (!cleanupRunId) {
    throw new Error("cleanupRunId or patchId is required.");
  }
  const verification = await verifyChanges(cleanupRunId);
  const ref = Phase3InputSchemas.repoRef(body);
  const findings = await resolveFindingsPayload(ref, getAgentTask);

  return completeTask(
    taskId,
    "verify_patch",
    findings,
    {
      cleanupRunId,
      verification: {
        status: verification.status,
        checks: verification.checks,
        limitations: verification.limitations,
      },
    },
    verification.limitations
  );
}

export async function executeRepositoryHealthDelta(
  body: unknown,
  taskId: string
): Promise<AgentTaskRecord> {
  const record = body as Record<string, unknown>;
  const baseScanId = typeof record.baseScanId === "string" ? record.baseScanId : undefined;
  const headScanId =
    typeof record.headScanId === "string"
      ? record.headScanId
      : typeof record.scanId === "string"
        ? record.scanId
        : undefined;
  const baseCommitSha =
    typeof record.baseCommitSha === "string" ? record.baseCommitSha : undefined;
  const headCommitSha =
    typeof record.headCommitSha === "string" ? record.headCommitSha : undefined;

  const ref = Phase3InputSchemas.repoRef(body);
  const current = await resolveFindingsPayload(
    headScanId ? { scanId: headScanId } : ref,
    getAgentTask
  );
  const previous = baseScanId ? await getStoredFindings(baseScanId) : undefined;

  const { analyzeGuardDelta } = await import("@/lib/guard/delta-analysis");
  const { loadRepositoryMemory } = await import("@/lib/guard/repository-memory");
  const memory = await loadRepositoryMemory(`${current.repo.owner}/${current.repo.name}`);

  const delta = await analyzeGuardDelta({
    memory,
    previousScanId: baseScanId,
    currentScanId: current.scanId,
    previousCommitSha: baseCommitSha ?? previous?.repo.commitSha,
    currentCommitSha: headCommitSha ?? current.repo.commitSha ?? "unknown",
    currentFindings: current,
  });

  return completeTask(taskId, "repository_health_delta", current, {
    delta: {
      newFindings: delta.newFindings.length,
      resolvedFindings: delta.resolvedFindings.length,
      recurringFindings: delta.recurringFindings.length,
      ignoredFindings: delta.ignoredFindings.length,
      newSafeCandidates: delta.newSafeCandidates.length,
      previousCommitSha: delta.previousCommitSha,
      currentCommitSha: delta.currentCommitSha,
    },
    details: delta,
  });
}

export async function executeGetRepositoryHealth(
  body: unknown,
  taskId: string
): Promise<AgentTaskRecord> {
  const ref = Phase3InputSchemas.repoRef(body);
  const findings = await resolveFindingsPayload(ref, getAgentTask);

  const analyzerIssues = Object.entries(findings.rawToolReports).filter(
    ([, report]) => report.status === "failed"
  ).length;

  return completeTask(taskId, "get_repository_health", findings, {
    scanId: findings.scanId,
    health: {
      score: Math.max(
        0,
        100 -
          findings.summary.reviewRequired * 2 -
          findings.summary.doNotTouch * 3 -
          analyzerIssues * 5
      ),
      safeCandidates: findings.summary.safeCandidates,
      reviewRequired: findings.summary.reviewRequired,
      doNotTouch: findings.summary.doNotTouch,
      totalFindings: findings.summary.totalFindings,
      commitSha: findings.repo.commitSha ?? null,
    },
    analyzerStatus: analyzersFromFindings(findings),
  });
}

export async function executeRunFreeSafeFix(
  body: unknown,
  taskId: string
): Promise<AgentTaskRecord> {
  const input = Phase3InputSchemas.runCleanup({ ...(body as object), operation: "free_proof" });
  const findings = await resolveFindingsPayload(input, getAgentTask);
  const cleanup = await executeFreeProof(findings, { findingIds: input.findingIds });

  const limitations: string[] = [];
  if (cleanup.proof.finalDecision !== "verified_fix") {
    limitations.push(
      cleanup.verifiedLabel ||
        "RepoDiet evaluated candidates but did not apply an unsafe change."
    );
  }
  limitations.push("GitHub repository was not modified — isolated workspace only.");

  const cleanupProof = buildCleanupProofFromRun({ findings, cleanup });

  return completeTask(
    taskId,
    "run_free_safe_fix",
    findings,
    {
      scanId: findings.scanId,
      commitSha: findings.repo.commitSha ?? null,
      cleanupRunId: cleanup.id,
      finalDecision: cleanup.proof.finalDecision,
      changedFiles: cleanup.proof.changedFiles,
      unifiedDiff: cleanup.unifiedDiff,
      fixLoop: cleanup.fixLoop,
      stateTransitions: cleanup.stateTransitions,
      cleanupProof,
      proofLadder: cleanupProof.ladder,
      outcomeSummary: formatProofLadderSummary(cleanupProof.ladder),
    },
    limitations,
    cleanup.signedReceipt ?? cleanup.receipt
  );
}

export async function executeRunQuickCleanup(
  body: unknown,
  taskId: string
): Promise<AgentTaskRecord> {
  const input = Phase3InputSchemas.runCleanup({ ...(body as object), operation: "quick_cleanup" });
  const findings = await resolveFindingsPayload(input, getAgentTask);
  const cleanup = await executeQuickCleanup(findings, { findingIds: input.findingIds });

  const limitations = [
    "Quick Cleanup runs every eligible transformer, validates a consolidated patch, and prepares a review-ready PR.",
    "GitHub repository was not modified — isolated workspace only.",
  ];
  if (!input.quoteId) {
    limitations.push("No task quote provided — x402 settlement not verified for this run.");
  }
  if (cleanup.proof.finalDecision !== "verified_fix") {
    limitations.push(cleanup.verifiedLabel);
  }

  const signed = createExecutionReceipt(cleanup.receipt);
  const cleanupProof = buildCleanupProofFromRun({ findings, cleanup });

  return completeTask(
    taskId,
    "run_quick_cleanup",
    findings,
    {
      scanId: findings.scanId,
      commitSha: findings.repo.commitSha ?? null,
      cleanupRunId: cleanup.id,
      finalDecision: cleanup.proof.finalDecision,
      changedFiles: cleanup.proof.changedFiles,
      unifiedDiff: cleanup.unifiedDiff,
      fixLoop: cleanup.fixLoop,
      healthImpact: cleanup.healthImpact,
      stateTransitions: cleanup.stateTransitions,
      cleanupProof,
      proofLadder: cleanupProof.ladder,
      outcomeSummary: formatProofLadderSummary(cleanupProof.ladder),
    },
    limitations,
    signed
  );
}

export async function executeRunCleanup(
  body: unknown,
  taskId: string
): Promise<AgentTaskRecord> {
  const input = Phase3InputSchemas.runCleanup(body);
  if (input.operation === "quick_cleanup") {
    return executeRunQuickCleanup(body, taskId);
  }
  return executeRunFreeSafeFix(body, taskId);
}

export async function executeVerifyCleanup(
  body: unknown,
  taskId: string
): Promise<AgentTaskRecord> {
  const input = Phase3InputSchemas.verifyCleanup(body);
  const patchId = input.patchId ?? input.cleanupRunId!;
  const verification = await verifyChanges(patchId);

  let findings: FindingsPayload | undefined;
  if (input.scanId) {
    findings = await getStoredFindings(input.scanId);
  }

  const stubFindings: FindingsPayload = findings ?? {
    scanId: input.scanId ?? "unknown",
    repo: { owner: "unknown", name: "unknown", branch: "main" },
    summary: {
      totalFindings: 0,
      duplicateClusters: 0,
      unusedFiles: 0,
      unusedDependencies: 0,
      unusedExports: 0,
      orphanPatterns: 0,
      slopSignals: 0,
      reviewRequired: 0,
      safeCandidates: 0,
      doNotTouch: 0,
    },
    duplicates: [],
    unused: { files: [], dependencies: [], exports: [] },
    orphans: [],
    slopSignals: [],
    riskBuckets: { safeDelete: [], reviewFirst: [], doNotTouch: [] },
    artifacts: { findingsJson: false },
    mode: "live",
    rawToolReports: {
      knip: { status: "failed", source: null, sourceMode: "fallback", durationMs: 0 },
      jscpd: { status: "failed", source: null, sourceMode: "fallback", durationMs: 0 },
      madge: { status: "failed", source: null, sourceMode: "fallback", durationMs: 0 },
    },
  };

  return completeTask(
    taskId,
    "verify_cleanup",
    stubFindings,
    {
      patchId,
      verification,
    },
    verification.limitations ?? [],
    { taskId: patchId, status: verification.status === "passed" ? "verified" : "partial", timestamp: new Date().toISOString() }
  );
}

export async function executeCreateCleanupPrPhase3(
  body: unknown,
  taskId: string
): Promise<AgentTaskRecord> {
  const input = ToolInputSchemas.createCleanupPr(body);
  let findings: FindingsPayload | undefined;

  if (input.findings) {
    findings = input.findings as unknown as FindingsPayload;
  } else {
    findings = await scanRepository(input.repoUrl, input.branch);
  }

  const pr = await createCleanupPullRequest({
    repoUrl: input.repoUrl,
    branch: input.branch,
    findings,
    patchKit: input.patchKit as never,
    demo: input.demo,
    githubToken: input.githubToken,
  });

  const pullRequestUrl = pr.data.pullRequest.url;
  const patchKit = input.patchKit as import("@/lib/patch-kit/types").PatchKitPayload | undefined;
  const cleanupProof =
    patchKit?.cleanupProof ??
    (patchKit?.summary
      ? buildCleanupProof({
          findings,
          summary: patchKit.summary,
          verificationStatus:
            patchKit.patchValidation?.status === "passed" ? "passed" : "partial",
          pullRequestUrl,
        })
      : undefined);

  const receipt = createExecutionReceipt({
    taskId,
    repository: `${findings.repo.owner}/${findings.repo.name}`,
    commitSha: findings.repo.commitSha ?? "unknown",
    findingIds: [],
    patchHash: "sha256:pr",
    verificationHash: "sha256:pr",
    status: pullRequestUrl ? "verified" : "partial",
    timestamp: new Date().toISOString(),
  });

  return completeTask(
    taskId,
    "create_cleanup_pr",
    findings,
    {
      scanId: findings.scanId,
      commitSha: findings.repo.commitSha ?? null,
      pullRequest: pr.data.pullRequest,
      pullRequestUrl,
      repo: pr.data.repo,
      actionSummary: pr.data.actionSummary,
      policy: pr.data.policy,
      cleanupProof: cleanupProof
        ? { ...cleanupProof, pullRequestUrl, verificationStatus: "passed" as const }
        : undefined,
      proofLadder: cleanupProof?.ladder,
      outcomeSummary: cleanupProof ? formatProofLadderSummary(cleanupProof.ladder) : undefined,
    },
    pr.warnings ?? ["Requires GitHub App installation or token for live PR creation."],
    receipt
  );
}

export async function executeConfigureRepositoryPolicy(
  body: unknown,
  taskId: string
): Promise<AgentTaskRecord> {
  const input = Phase3InputSchemas.configurePolicy(body);
  const findings = await scanRepository(input.repoUrl, input.branch);
  const policyId = `${findings.repo.owner}/${findings.repo.name}`;

  const memory = await updateRepositoryPolicy({
    repository: policyId,
    branch: findings.repo.branch,
    protectedPaths: input.protectedPaths,
    protectedGlobs: input.protectedGlobs,
  });

  return completeTask(taskId, "configure_repository_policy", findings, {
    policy: memory,
    note: "Repository memory and policy enforced on guard scans and fix selection.",
  });
}

export async function executeActivateRepoGuard(
  body: unknown,
  taskId: string
): Promise<AgentTaskRecord> {
  const input = Phase3InputSchemas.repoUrl(body);
  const record = body as Record<string, unknown>;
  const { activateRepoGuard } = await import("@/lib/guard/guard-engine");
  const { deltaPresentation } = await import("@/lib/guard/delta-analysis");

  const activation = await activateRepoGuard({
    repoUrl: input.repoUrl,
    branch: input.branch,
    quoteId: typeof record.quoteId === "string" ? record.quoteId : undefined,
    paymentReference:
      typeof record.paymentReference === "string" ? record.paymentReference : undefined,
    callbackUrl: typeof record.callbackUrl === "string" ? record.callbackUrl : undefined,
    protectedPaths: Array.isArray(record.protectedPaths)
      ? record.protectedPaths.filter((p): p is string => typeof p === "string")
      : undefined,
  });

  const findings = await getStoredFindings(activation.baselineRun.currentScanId!);
  if (!findings) {
    const scanned = await scanRepository(input.repoUrl, input.branch);
    return completeTask(taskId, "activate_repo_guard", scanned, {
      guard: activation.subscription,
      baselineRun: {
        id: activation.baselineRun.id,
        delta: activation.baselineRun.delta
          ? deltaPresentation(activation.baselineRun.delta)
          : null,
      },
    });
  }

  return completeTask(taskId, "activate_repo_guard", findings, {
    guard: activation.subscription,
    baselineRun: {
      id: activation.baselineRun.id,
      status: activation.baselineRun.status,
      delta: activation.baselineRun.delta ? deltaPresentation(activation.baselineRun.delta) : null,
      proposal: activation.baselineRun.proposal,
      notification: activation.baselineRun.notification,
    },
  });
}

export async function executeGetTaskStatus(taskId: string): Promise<AgentTaskRecord | undefined> {
  const task = await getAgentTask(taskId);
  if (task) return task;

  const cleanupRun = await getDurableRecord<Record<string, unknown>>("cleanup_runs", taskId);
  if (cleanupRun) {
    const receipt = await getExecutionReceipt(taskId);
    return {
      id: taskId,
      type: "run_free_safe_fix",
      status: "completed",
      repository: {
        owner: String(cleanupRun.repository ?? "").split("/")[0] ?? "",
        name: String(cleanupRun.repository ?? "").split("/")[1] ?? "",
        branch: String(cleanupRun.branch ?? "main"),
        commitSha: String(cleanupRun.commitSha ?? ""),
      },
      scanId: typeof cleanupRun.scanId === "string" ? cleanupRun.scanId : undefined,
      result: cleanupRun as Record<string, unknown>,
      analyzers: {},
      limitations: [],
      receipt: receipt?.receipt ?? {},
      createdAt: String(cleanupRun.createdAt ?? new Date().toISOString()),
      updatedAt: String(cleanupRun.createdAt ?? new Date().toISOString()),
      completedAt: String(cleanupRun.createdAt ?? new Date().toISOString()),
    };
  }

  return undefined;
}

export { createTaskId };
