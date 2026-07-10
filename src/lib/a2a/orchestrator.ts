import {
  analyzeRepository,
  createCleanupPullRequest,
  createExecutionReceipt,
  createTaskQuote,
  executeFreeProof,
  runQuickCleanup,
  scanRepository,
  selectSafeFixes,
} from "@/lib/execution";
import { runVerification } from "@/lib/verify/run-verification";
import { validateTaskQuote } from "@/lib/execution/task-quote";
import { getStoredFindings } from "@/lib/findings/findings-store";
import type { FindingsPayload } from "@/lib/findings/types";
import { getTaskQuote } from "@/lib/store/product-store";
import { parseGitHubUrl } from "@/lib/github/parse-github-url";
import { A2ATaskStateMachine } from "./task-state-machine";
import {
  buildInitialTask,
  getA2ATask,
  saveA2ATask,
  updateA2ATask,
} from "./task-store";
import { deliverTaskCallback, persistTask } from "./callbacks";
import {
  mapTaskTypeToOperation,
  requiresPayment,
  type A2ATaskInput,
  type A2ATaskRecord,
  type A2ATaskType,
} from "./types";

const APPROVAL_TTL_MS = 30 * 60 * 1000;

function repoFromUrl(repoUrl: string, branch?: string): A2ATaskRecord["repository"] {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) {
    throw new Error("Invalid GitHub repository URL.");
  }
  return {
    owner: parsed.owner,
    name: parsed.repo,
    branch: branch ?? parsed.branch ?? "main",
    url: repoUrl,
  };
}

async function syncTask(
  task: A2ATaskRecord,
  sm: A2ATaskStateMachine,
  patch: Partial<A2ATaskRecord> = {}
): Promise<A2ATaskRecord> {
  const updated: A2ATaskRecord = {
    ...task,
    ...patch,
    status: sm.current(),
    transitions: sm.cloneTransitions(),
    updatedAt: new Date().toISOString(),
  };
  return persistTask(updated);
}

async function failTask(
  task: A2ATaskRecord,
  sm: A2ATaskStateMachine,
  status: A2ATaskRecord["status"],
  error: string,
  role: A2ATaskRecord["transitions"][number]["role"] = "orchestrator"
): Promise<A2ATaskRecord> {
  sm.emit(status, role, error);
  const finalized: A2ATaskRecord = {
    ...task,
    status,
    error,
    transitions: sm.cloneTransitions(),
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
  await saveA2ATask(finalized);
  await deliverTaskCallback(finalized);
  return finalized;
}

async function completeTask(
  task: A2ATaskRecord,
  sm: A2ATaskStateMachine,
  result: A2ATaskRecord["result"],
  limitations: string[] = []
): Promise<A2ATaskRecord> {
  sm.emit("completed", "orchestrator");
  const finalized: A2ATaskRecord = {
    ...task,
    status: "completed",
    result,
    limitations,
    transitions: sm.cloneTransitions(),
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
  await saveA2ATask(finalized);
  await deliverTaskCallback(finalized);
  return finalized;
}

async function loadFindings(task: A2ATaskRecord): Promise<FindingsPayload> {
  if (task.scanId) {
    const stored = await getStoredFindings(task.scanId);
    if (stored) return stored;
  }
  return scanRepository(task.input.repoUrl, task.input.branch);
}

async function runAnalysisPhase(
  task: A2ATaskRecord,
  sm: A2ATaskStateMachine
): Promise<A2ATaskRecord | { task: A2ATaskRecord; findings: FindingsPayload }> {
  sm.emit("validating", "orchestrator");
  task = await syncTask(task, sm);
  sm.emit("queued", "orchestrator");
  task = await syncTask(task, sm);
  sm.emit("fetching_repository", "repository_analyzer");
  task = await syncTask(task, sm);

  let findings: FindingsPayload;
  try {
    findings = await scanRepository(task.input.repoUrl, task.input.branch);
    task = await syncTask(task, sm, {
      scanId: findings.scanId,
      repository: { ...task.repository, commitSha: findings.repo.commitSha },
    });
  } catch (err) {
    return failTask(
      task,
      sm,
      "analysis_failed",
      err instanceof Error ? err.message : "Repository fetch failed.",
      "repository_analyzer"
    );
  }

  sm.emit("analyzing", "repository_analyzer");
  task = await syncTask(task, sm);
  const analyzed = await analyzeRepository(findings);
  task = await syncTask(task, sm, {
    result: {
      ...task.result,
      findings: {
        scanId: analyzed.scanId,
        summary: analyzed.summary,
        riskBuckets: analyzed.riskBuckets,
      },
    },
  });

  return { task, findings: analyzed };
}

async function ensurePayment(
  task: A2ATaskRecord,
  sm: A2ATaskStateMachine,
  findings: FindingsPayload
): Promise<A2ATaskRecord> {
  if (!requiresPayment(task.type)) {
    sm.emit("funded", "orchestrator", "No payment required.");
    return syncTask(task, sm);
  }

  const operation = mapTaskTypeToOperation(task.type);
  if (!operation) {
    return failTask(task, sm, "unsupported", "Task type does not support payment mapping.");
  }

  const hasPayment = Boolean(task.input.quoteId || task.input.paymentReference);
  if (!hasPayment) {
    sm.emit("quote_required", "orchestrator");
    const quote = createTaskQuote({
      repository: `${findings.repo.owner}/${findings.repo.name}`,
      branch: findings.repo.branch,
      commitSha: findings.repo.commitSha ?? "unknown",
      findingIds: task.input.findingIds ?? [],
      operation,
      sourceFileCount: findings.summary.totalFindings,
    });
    task = await syncTask(task, sm, {
      quoteId: quote.quoteId,
      limitations: [
        ...task.limitations,
        `Quote required: ${quote.priceLabel}. Fund via POST /api/a2a/tasks/${task.id}/fund`,
      ],
      result: { ...task.result, receipt: { quote } },
    });
    sm.emit("awaiting_payment", "orchestrator", quote.quoteId);
    return syncTask(task, sm);
  }

  if (task.input.quoteId) {
    const quoteRecord = await getTaskQuote(task.input.quoteId);
    if (quoteRecord) {
      const validation = validateTaskQuote(quoteRecord, {
        repository: `${findings.repo.owner}/${findings.repo.name}`,
        branch: findings.repo.branch,
        commitSha: findings.repo.commitSha ?? "unknown",
        findingIds: task.input.findingIds ?? [],
        operation,
      });
      if (!validation.ok) {
        return failTask(task, sm, "payment_failed", validation.reason ?? "Quote validation failed.");
      }
    }
  }

  sm.emit("funded", "orchestrator", task.input.paymentReference ?? task.input.quoteId);
  return syncTask(task, sm);
}

async function executeChanges(
  task: A2ATaskRecord,
  sm: A2ATaskStateMachine,
  analyzed: FindingsPayload
): Promise<A2ATaskRecord> {
  const input = task.input;

  if (task.type === "repository.analysis") {
    return completeTask(task, sm, task.result);
  }

  if (task.type === "repository.safe_cleanup") {
    sm.emit("generating_changes", "fix_executor");
    task = await syncTask(task, sm);
    try {
      const cleanup = await executeFreeProof(analyzed, { findingIds: input.findingIds });
      sm.emit("validating_patch", "fix_executor");
      task = await syncTask(task, sm);
      sm.emit("verifying", "verification_worker");
      task = await syncTask(task, sm);

      if (cleanup.proof.finalDecision !== "retained") {
        return failTask(
          task,
          sm,
          "verification_failed",
          cleanup.fixLoop.attempts[0]?.reason ?? "Safe fix not retained after verification.",
          "verification_worker"
        );
      }

      return completeTask(
        task,
        sm,
        {
          findings: task.result.findings,
          changes: {
            changedFiles: cleanup.proof.changedFiles,
            unifiedDiff: cleanup.unifiedDiff,
            finalDecision: cleanup.proof.finalDecision,
          },
          verification: {
            status: cleanup.verification.status,
            checks: cleanup.verification.checks,
            limitations: cleanup.verification.limitations,
          },
          receipt: (cleanup.signedReceipt ?? cleanup.receipt) as Record<string, unknown>,
        },
        cleanup.limitations
      );
    } catch (err) {
      return failTask(
        task,
        sm,
        "verification_failed",
        err instanceof Error ? err.message : "Safe cleanup failed.",
        "fix_executor"
      );
    }
  }

  if (task.type === "repository.verified_cleanup") {
    sm.emit("generating_changes", "fix_executor");
    task = await syncTask(task, sm);
    try {
      const patchKit = await runQuickCleanup(
        input.repoUrl,
        input.branch,
        analyzed,
        input.findingIds
      );
      sm.emit("validating_patch", "fix_executor");
      task = await syncTask(task, sm);
      sm.emit("verifying", "verification_worker");
      task = await syncTask(task, sm);

      const verification = await runVerification(patchKit.id, patchKit);
      if (verification.status === "failed") {
        return failTask(task, sm, "verification_failed", "Patch verification failed.", "verification_worker");
      }

      const receipt = createExecutionReceipt({
        taskId: task.id,
        repository: `${analyzed.repo.owner}/${analyzed.repo.name}`,
        commitSha: analyzed.repo.commitSha ?? "unknown",
        findingIds: input.findingIds ?? [],
        patchHash: "sha256:patchkit",
        verificationHash: "sha256:verified",
        status: verification.status === "passed" ? "verified" : "partial",
        quoteId: task.input.quoteId,
        paymentReference: task.input.paymentReference,
        timestamp: new Date().toISOString(),
      });

      return completeTask(task, sm, {
        findings: task.result.findings,
        changes: {
          changedFiles: patchKit.summary.deletedPaths ?? [],
          unifiedDiff: patchKit.artifacts.cleanupPatch,
          patchId: patchKit.id,
        },
        verification,
        receipt: receipt as Record<string, unknown>,
      });
    } catch (err) {
      return failTask(
        task,
        sm,
        "verification_failed",
        err instanceof Error ? err.message : "Verified cleanup failed.",
        "fix_executor"
      );
    }
  }

  if (task.type === "repository.cleanup_pr") {
    sm.emit("generating_changes", "fix_executor");
    task = await syncTask(task, sm);
    try {
      const safe = selectSafeFixes(analyzed, 10);
      sm.emit("validating_patch", "safety_classifier", `${safe.length} safe fixes evaluated`);
      task = await syncTask(task, sm);

      const patchKit = await runQuickCleanup(
        input.repoUrl,
        input.branch,
        analyzed,
        input.findingIds ?? safe.map((f) => f.id)
      );

      sm.emit("verifying", "verification_worker");
      task = await syncTask(task, sm);
      const verification = await runVerification(patchKit.id, patchKit);
      if (verification.status === "failed") {
        return failTask(
          task,
          sm,
          "verification_failed",
          "Cleanup verification failed before PR approval.",
          "verification_worker"
        );
      }

      const changedFiles = patchKit.summary.deletedPaths ?? [];
      const approval = {
        summary: `${changedFiles.length} file(s) will change on branch repodiet/cleanup-${task.id}`,
        repository: `${analyzed.repo.owner}/${analyzed.repo.name}`,
        branch: `repodiet/cleanup-${task.id}`,
        changes: changedFiles.map((path) => ({
          path,
          action: "delete" as const,
          summary: "Safe candidate removal",
        })),
        unifiedDiff: patchKit.artifacts.cleanupPatch,
        expiresAt: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
      };

      sm.emit("awaiting_approval", "orchestrator");
      return syncTask(task, sm, {
        approval,
        result: {
          findings: task.result.findings,
          changes: {
            changedFiles,
            unifiedDiff: patchKit.artifacts.cleanupPatch,
            patchId: patchKit.id,
          },
          verification,
        },
      });
    } catch (err) {
      return failTask(
        task,
        sm,
        "analysis_failed",
        err instanceof Error ? err.message : "Cleanup PR preparation failed.",
        "fix_executor"
      );
    }
  }

  return failTask(task, sm, "unsupported", "Unsupported task type.");
}

export async function submitA2ATask(type: A2ATaskType, input: A2ATaskInput): Promise<A2ATaskRecord> {
  if (type === "repository.guard_activation") {
    const task = buildInitialTask(type, input, repoFromUrl(input.repoUrl, input.branch));
    const sm = new A2ATaskStateMachine(task.transitions);
    return failTask(task, sm, "unsupported", "Repo Guard activation is not available in this release.");
  }

  let task = buildInitialTask(type, input, repoFromUrl(input.repoUrl, input.branch));
  const sm = new A2ATaskStateMachine(task.transitions);
  await saveA2ATask(task);

  const analysis = await runAnalysisPhase(task, sm);
  if (!("findings" in analysis)) return analysis;
  const { task: analyzedTask, findings } = analysis;
  task = analyzedTask;

  if (type === "repository.analysis") {
    return completeTask(task, sm, task.result);
  }

  task = await ensurePayment(task, sm, findings);
  if (task.status === "awaiting_payment" || task.status === "quote_required") {
    return task;
  }

  return executeChanges(task, sm, findings);
}

export async function fundA2ATask(
  taskId: string,
  input: { quoteId?: string; paymentReference?: string }
): Promise<A2ATaskRecord> {
  const existing = await getA2ATask(taskId);
  if (!existing) throw new Error("Task not found.");
  if (existing.status !== "awaiting_payment" && existing.status !== "quote_required") {
    throw new Error(`Task is not awaiting payment (status=${existing.status}).`);
  }

  const task = await updateA2ATask(taskId, {
    input: {
      ...existing.input,
      quoteId: input.quoteId ?? existing.input.quoteId,
      paymentReference:
        input.paymentReference ?? existing.input.paymentReference ?? `beta_${Date.now()}`,
    },
  });
  if (!task) throw new Error("Failed to update task.");

  const sm = new A2ATaskStateMachine(task.transitions);
  const findings = await loadFindings(task);
  const funded = await ensurePayment(task, sm, findings);
  if (funded.status === "payment_failed") return funded;
  return executeChanges(funded, sm, findings);
}

export async function approveA2ATask(taskId: string, approved: boolean): Promise<A2ATaskRecord> {
  const task = await getA2ATask(taskId);
  if (!task) throw new Error("Task not found.");
  if (task.status !== "awaiting_approval") {
    throw new Error(`Task is not awaiting approval (status=${task.status}).`);
  }
  if (task.approval?.expiresAt && new Date(task.approval.expiresAt).getTime() < Date.now()) {
    const sm = new A2ATaskStateMachine(task.transitions);
    return failTask(task, sm, "expired", "Approval checkpoint expired.");
  }
  if (!approved) {
    const sm = new A2ATaskStateMachine(task.transitions);
    return failTask(task, sm, "cancelled", "Approval rejected by client agent.");
  }

  const sm = new A2ATaskStateMachine(task.transitions);
  sm.emit("creating_pull_request", "github_delivery_worker");
  let current = await syncTask(task, sm);

  try {
    const findings = await loadFindings(task);
    const pr = await createCleanupPullRequest({
      repoUrl: task.input.repoUrl,
      branch: task.input.branch,
      findings,
      demo: task.input.demo,
      githubToken: task.input.githubToken,
    });

    const receipt = createExecutionReceipt({
      taskId: task.id,
      repository: `${findings.repo.owner}/${findings.repo.name}`,
      commitSha: findings.repo.commitSha ?? "unknown",
      findingIds: task.input.findingIds ?? [],
      patchHash: "sha256:pr",
      verificationHash: "sha256:pr",
      status: "verified",
      quoteId: task.input.quoteId,
      paymentReference: task.input.paymentReference,
      timestamp: new Date().toISOString(),
    });

    return completeTask(current, sm, {
      ...current.result,
      pullRequest: {
        url: pr.data.pullRequest.url,
        number: pr.data.pullRequest.number,
        title: pr.data.pullRequest.title,
        branch: pr.data.repo.cleanupBranch,
      },
      receipt: receipt as Record<string, unknown>,
    });
  } catch (err) {
    return failTask(
      current,
      sm,
      "delivery_failed",
      err instanceof Error ? err.message : "Pull request creation failed.",
      "github_delivery_worker"
    );
  }
}

export async function cancelA2ATask(taskId: string): Promise<A2ATaskRecord> {
  const task = await getA2ATask(taskId);
  if (!task) throw new Error("Task not found.");
  const sm = new A2ATaskStateMachine(task.transitions);
  return failTask(task, sm, "cancelled", "Task cancelled by client.");
}

export function formatA2ATaskResponse(task: A2ATaskRecord) {
  return {
    taskId: task.id,
    type: task.type,
    status: task.status,
    repository: task.repository,
    scanId: task.scanId,
    approval: task.approval,
    findings: task.result.findings ?? {},
    changes: task.result.changes ?? {},
    verification: task.result.verification ?? {},
    pullRequest: task.result.pullRequest ?? {},
    receipt: task.result.receipt ?? {},
    transitions: task.transitions,
    limitations: task.limitations,
    error: task.error,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  };
}
