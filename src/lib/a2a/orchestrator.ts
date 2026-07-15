import {
  analyzeRepository,
  createCleanupPullRequest,
  createExecutionReceipt,
  executeFreeProof,
  runQuickCleanup,
  scanRepository,
} from "@/lib/execution";
import {
  createQuoteForOperation,
  requireEntitlement,
  verifyAndFundQuote,
  markQuoteCompleted,
  handleExecutionFailure,
  signTestPaymentPayload,
  getBoundQuote,
  paymentProofFromRequest,
} from "@/lib/payment";
import {
  validateVerifiedQuoteForA2aFund,
  A2A_FUNDABLE_STATUSES,
  A2A_FUNDED_OR_EXECUTING_STATUSES,
  quoteIdForTask,
} from "@/lib/a2a/a2a-funding";
import { getOkxOrderByA2aTask, updateOkxOrder } from "@/lib/okx/store";
import {
  claimA2aFundLock,
  getA2aFundLock,
  markA2aFundExecutionQueued,
  releaseA2aFundLockIfToken,
  savePaymentRecord,
  updateBoundQuote,
} from "@/lib/payment/payment-store";
import { getStoredFindings } from "@/lib/findings/findings-store";
import type { FindingsPayload } from "@/lib/findings/types";
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
  A2A_FAILURE_STATUSES,
  mapTaskTypeToOperation,
  requiresPayment,
  type A2ATaskInput,
  type A2ATaskRecord,
  type A2ATaskType,
} from "./types";
import { runPatchKitEngine } from "@/lib/patch-kit/patch-kit-engine";
import { getStoredPatchKit } from "@/lib/patch-kit/patch-kit-store";
import {
  patchKitDeliveryBlocker,
  patchKitHasDeliverableChanges,
  waitForPatchKitSandbox,
} from "./patch-kit-delivery";
import { withRefreshedVerificationGates } from "@/lib/patch-kit/refresh-verification-gates";
import {
  assertPreQuoteGate,
  PreQuoteGateError,
} from "@/lib/workflow/pre-quote-gate";
import { flattenFindings } from "@/lib/findings/client";
import { monitorTaskPullRequestDelivery } from "@/lib/github/monitor-pr-delivery";
import {
  authorizeExecutorDispatch,
  getMaintenanceContract,
  type GreenPrOperation,
} from "@/lib/green-pr";
import { resolvePhase1Plugin } from "@/lib/execution/fix-plugins/phase1-plugins";
import type { Finding } from "@/lib/findings/types";

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
  if (
    task.input.quoteId &&
    (status === "verification_failed" || status === "delivery_failed")
  ) {
    await handleExecutionFailure(
      task.input.quoteId,
      status === "delivery_failed" ? "platform_failure" : "verification_failed"
    );
  }
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
  if (task.input.quoteId) {
    await markQuoteCompleted(task.input.quoteId, task.id);
  }
  return finalized;
}

async function loadFindings(task: A2ATaskRecord): Promise<FindingsPayload> {
  if (task.scanId) {
    const stored = await getStoredFindings(task.scanId);
    if (stored) return stored;
  }
  return scanRepository(task.input.repoUrl, task.input.branch);
}

async function assertBoundMaintenanceContract(
  task: A2ATaskRecord,
  findings: FindingsPayload
): Promise<A2ATaskRecord> {
  const { contractId, contractDigest } = task.input;
  if (!contractId && !contractDigest) return task;
  if (!contractId || !contractDigest) throw new Error("maintenance_contract_binding_incomplete");
  const record = await getMaintenanceContract(contractId);
  if (!record) throw new Error("maintenance_contract_not_found");
  if (record.contractDigest !== contractDigest) throw new Error("contract_digest_mismatch");
  if (record.status !== "accepted") throw new Error(`maintenance_contract_not_accepted:${record.status}`);
  if (new Date(record.contract.commercialTerms.expiry).getTime() <= Date.now()) {
    throw new Error("maintenance_contract_expired");
  }
  const repository = `${findings.repo.owner}/${findings.repo.name}`;
  const contractedRepository = `${record.contract.repository.owner}/${record.contract.repository.name}`;
  if (repository !== contractedRepository) throw new Error("contract_repository_mismatch");
  if (findings.repo.branch !== record.contract.repository.branch) {
    throw new Error("contract_branch_mismatch");
  }
  if (findings.repo.commitSha !== record.contract.repository.sourceCommit) {
    throw new Error("contract_source_commit_mismatch");
  }
  if (task.input.quoteId !== record.contract.commercialTerms.quoteId) {
    throw new Error("contract_quote_mismatch");
  }
  const selected = new Set(task.input.findingIds ?? []);
  const contracted = new Set(record.contract.scope.findingIds);
  if (selected.size !== contracted.size || [...contracted].some((id) => !selected.has(id))) {
    throw new Error("contract_finding_scope_mismatch");
  }
  const updated: A2ATaskRecord = {
    ...task,
    result: {
      ...task.result,
      maintenanceContract: {
        contractId: record.contractId,
        contractDigest: record.contractDigest,
        status: record.status,
      },
    },
  };
  return saveA2ATask(updated);
}

function contractedOperationForFinding(finding: Finding): GreenPrOperation {
  const plugin = resolvePhase1Plugin(finding).id;
  switch (plugin) {
    case "remove_unused_import":
      return "remove_unused_import";
    case "remove_unused_dependency":
      return "remove_unused_dependency";
    case "remove_empty_file":
      return "remove_empty_file";
    case "remove_temp_file":
      return finding.files.some((path) => /(?:backup|archive|\.old\.|\/old\/)/i.test(path))
        ? "remove_backup_file"
        : "remove_temporary_file";
    case "remove_confirmed_unused_file":
      return "delete_unreachable_module";
    case "consolidate_exact_duplicate":
      return "consolidate_exact_duplicate";
    default:
      throw new Error(`contract_operation_unresolved:${finding.id}`);
  }
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
    if (task.input.scanId) {
      const stored = await getStoredFindings(task.input.scanId);
      if (!stored) {
        return failTask(
          task,
          sm,
          "analysis_failed",
          "Stored scan findings were not found. Re-run Findings and try again.",
          "repository_analyzer"
        );
      }
      if (
        task.input.commitSha?.trim() &&
        stored.repo.commitSha &&
        stored.repo.commitSha !== task.input.commitSha
      ) {
        return failTask(
          task,
          sm,
          "analysis_failed",
          "Scan commit no longer matches the pinned repository commit. Re-run Findings on the current commit.",
          "repository_analyzer"
        );
      }
      findings = stored;
    } else {
      findings = await scanRepository(task.input.repoUrl, task.input.branch);
    }
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

  const repository = `${findings.repo.owner}/${findings.repo.name}`;
  const findingIds = task.input.findingIds ?? [];

  if (!task.input.quoteId) {
    let gateResult: Awaited<ReturnType<typeof assertPreQuoteGate>>;
    try {
      gateResult = await assertPreQuoteGate({
        repoUrl: task.input.repoUrl,
        branch: task.input.branch ?? findings.repo.branch,
        scanId: task.input.scanId ?? findings.scanId,
        commitSha: task.input.commitSha ?? findings.repo.commitSha ?? "unknown",
        findingIds,
        findings: flattenFindings(findings),
        repository,
        taskId: task.id,
        // Empty scope quotes are allowed without transform hashes; payment still gates execution.
        skipTransformPreflight:
          Boolean(task.input.transformedSourceHashes) || findingIds.length === 0,
      });
    } catch (err) {
      if (err instanceof PreQuoteGateError) {
        return failTask(task, sm, "analysis_failed", err.message, "orchestrator");
      }
      throw err;
    }

    const eligibleFindingIds =
      gateResult.eligibleFindingIds.length > 0 ? gateResult.eligibleFindingIds : findingIds;
    const transformedSourceHashes =
      Object.keys(gateResult.transformedSourceHashes).length > 0
        ? gateResult.transformedSourceHashes
        : task.input.transformedSourceHashes;

    sm.emit("quote_required", "orchestrator");
    const quote = await createQuoteForOperation({
      repository,
      branch: findings.repo.branch,
      commitSha: findings.repo.commitSha ?? task.input.commitSha ?? "unknown",
      findingIds: eligibleFindingIds,
      operation,
      sourceFileCount: findings.summary.totalFindings,
      scanId: task.input.scanId ?? findings.scanId,
      transformedSourceHashes,
    });
    task = await syncTask(task, sm, {
      quoteId: quote.quoteId,
      input: {
        ...task.input,
        quoteId: quote.quoteId,
        findingIds: eligibleFindingIds,
        transformedSourceHashes,
      },
      limitations: [
        ...task.limitations,
        `Quote ${quote.quoteId}: ${quote.priceLabel}. Pay via POST /api/tasks/pay then POST /api/a2a/tasks/${task.id}/fund`,
      ],
      result: { ...task.result, receipt: { quote } },
    });
    await updateBoundQuote(quote.quoteId, { a2aTaskId: task.id });
    sm.emit("awaiting_payment", "orchestrator", quote.quoteId);
    return syncTask(task, sm);
  }

  const entitlement = await requireEntitlement({
    quoteId: task.input.quoteId,
    repository,
    branch: findings.repo.branch,
    commitSha: findings.repo.commitSha ?? task.input.commitSha ?? "unknown",
    findingIds,
    operation,
    taskId: task.id,
    scanId: task.input.scanId ?? findings.scanId,
    transformedSourceHashes: task.input.transformedSourceHashes,
    contractDigest: task.input.contractDigest,
  });

  if (!entitlement.ok) {
    if (entitlement.status === "payment_required") {
      sm.emit("awaiting_payment", "orchestrator", task.input.quoteId);
      return syncTask(task, sm, {
        limitations: [...task.limitations, entitlement.reason ?? "Payment required."],
      });
    }
    await handleExecutionFailure(task.input.quoteId, "invalid_payment");
    return failTask(task, sm, "payment_failed", entitlement.reason ?? "Entitlement denied.");
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

      if (cleanup.proof.finalDecision !== "verified_fix") {
        return failTask(
          task,
          sm,
          "verification_failed",
          cleanup.fixLoop.attempts[0]?.exactReason ??
            cleanup.fixLoop.attempts[0]?.displayReason ??
            "No verified fix retained after evaluation.",
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
      const cleanup = await runQuickCleanup(
        input.repoUrl,
        input.branch,
        analyzed,
        input.findingIds
      );
      sm.emit("validating_patch", "fix_executor");
      task = await syncTask(task, sm);
      sm.emit("verifying", "verification_worker");
      task = await syncTask(task, sm);

      if (cleanup.proof.finalDecision !== "verified_fix") {
        return failTask(
          task,
          sm,
          "verification_failed",
          cleanup.verifiedLabel ?? "No verified fixes retained.",
          "verification_worker"
        );
      }

      const verification = cleanup.verification;
      const receipt = createExecutionReceipt({
        taskId: task.id,
        repository: `${analyzed.repo.owner}/${analyzed.repo.name}`,
        commitSha: analyzed.repo.commitSha ?? "unknown",
        findingIds: input.findingIds ?? [],
        patchHash: cleanup.receipt.patchHash,
        verificationHash: cleanup.receipt.verificationHash,
        status: verification.status === "passed" ? "verified" : "partial",
        quoteId: task.input.quoteId,
        paymentReference: task.input.paymentReference,
        timestamp: new Date().toISOString(),
      });

      return completeTask(task, sm, {
        findings: task.result.findings,
        changes: {
          changedFiles: cleanup.proof.changedFiles,
          unifiedDiff: cleanup.unifiedDiff,
          patchId: cleanup.id,
          finalDecision: cleanup.proof.finalDecision,
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
      let patchKit = await runPatchKitEngine({
        repoUrl: input.repoUrl,
        branch: input.branch ?? analyzed.repo.branch,
        findings: analyzed,
        selectedFindingIds: input.findingIds,
        scanId: analyzed.scanId,
        paidExecution: true,
      });

      sm.emit("validating_patch", "fix_executor");
      task = await syncTask(task, sm);

      if (patchKit.patchValidation?.status === "pending_sandbox") {
        sm.emit("verifying", "verification_worker", "sandbox_validation");
        task = await syncTask(task, sm);
        patchKit = await waitForPatchKitSandbox(patchKit);
      } else {
        sm.emit("verifying", "verification_worker");
        task = await syncTask(task, sm);
      }

      const blocker = patchKitDeliveryBlocker(patchKit);
      if (!patchKitHasDeliverableChanges(patchKit)) {
        if (task.input.quoteId) {
          await handleExecutionFailure(task.input.quoteId, "verification_failed");
        }
        return failTask(
          task,
          sm,
          "verification_failed",
          blocker ?? "No verified cleanup changes were generated for the selected scope.",
          "verification_worker"
        );
      }

      const changedFiles = [
        ...new Set([
          ...(patchKit.summary.deletedPaths ?? []),
          ...(patchKit.changeOperations?.map((op) => op.filePath) ?? []),
          ...(patchKit.validatedEdits?.map((edit) => edit.path) ?? []),
        ]),
      ];

      let greenPrExecution: Record<string, unknown> | undefined;
      let contractedBranch: string | undefined;
      if (input.contractId && input.contractDigest) {
        const contractRecord = await getMaintenanceContract(input.contractId);
        if (!contractRecord || contractRecord.contractDigest !== input.contractDigest) {
          throw new Error("maintenance_contract_not_found_or_changed");
        }
        const findingById = new Map(
          flattenFindings(analyzed).map((finding) => [finding.id, finding] as const)
        );
        const operations = patchKit.changeOperations ?? [];
        if (operations.length === 0) throw new Error("contract_execution_manifest_missing");
        const dispatch = authorizeExecutorDispatch(contractRecord, {
          contractDigest: input.contractDigest,
          sourceCommit: analyzed.repo.commitSha ?? input.commitSha ?? "",
          findingIds: input.findingIds ?? [],
          changes: operations.map((operation) => {
            const finding = operation.findingIds
              .map((findingId) => findingById.get(findingId))
              .find((candidate): candidate is Finding => Boolean(candidate));
            if (!finding) throw new Error(`contract_finding_missing_for_change:${operation.filePath}`);
            const contractedOperation = contractedOperationForFinding(finding);
            return {
              path: operation.filePath,
              operation: contractedOperation,
              linesAdded: operation.linesAdded,
              linesDeleted: operation.linesRemoved,
              dependencyChanges: contractedOperation === "remove_unused_dependency" ? 1 : 0,
            };
          }),
        });
        contractedBranch = dispatch.branchName;
        greenPrExecution = dispatch as unknown as Record<string, unknown>;
      }

      const approval = {
        summary: `${changedFiles.length} file(s) will change on branch ${contractedBranch ?? `repodiet/cleanup-${task.id}`}`,
        repository: `${analyzed.repo.owner}/${analyzed.repo.name}`,
        branch: contractedBranch ?? `repodiet/cleanup-${task.id}`,
        changes: changedFiles.map((filePath) => ({
          path: filePath,
          action: (patchKit.summary.deletedPaths ?? []).includes(filePath)
            ? ("delete" as const)
            : ("modify" as const),
          summary: "Verified cleanup change",
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
            patchKitId: patchKit.id,
            finalDecision: "verified_fix",
          },
          verification: {
            status: patchKit.repositoryVerification?.status ??
              patchKit.patchValidation?.status ??
              "unknown",
            checks: patchKit.repositoryVerification?.checks,
            limitations: patchKit.patchValidation?.userMessage
              ? [patchKit.patchValidation.userMessage]
              : undefined,
            baseline: patchKit.repositoryVerification?.baseline,
            patched: patchKit.repositoryVerification?.patched,
          },
          greenPrExecution,
        },
      });
    } catch (err) {
      if (task.input.quoteId) {
        await handleExecutionFailure(task.input.quoteId, "verification_failed");
      }
      return failTask(
        task,
        sm,
        "verification_failed",
        err instanceof Error ? err.message : "Cleanup PR preparation failed.",
        "fix_executor"
      );
    }
  }

  if (task.type === "repository.guard_activation") {
    sm.emit("generating_changes", "orchestrator");
    task = await syncTask(task, sm);
    try {
      const { activateRepoGuard } = await import("@/lib/guard/guard-engine");
      const { deltaPresentation } = await import("@/lib/guard/delta-analysis");
      const activation = await activateRepoGuard({
        repoUrl: input.repoUrl,
        branch: input.branch,
        quoteId: task.input.quoteId,
        paymentReference: task.input.paymentReference,
        callbackUrl: input.callbackUrl,
      });
      if (task.input.quoteId) {
        await markQuoteCompleted(task.input.quoteId, task.id);
      }
      return completeTask(task, sm, {
        guard: {
          subscriptionId: activation.subscription.id,
          repository: activation.subscription.repository,
          status: activation.subscription.status,
          expiresAt: activation.subscription.expiresAt,
          monthlyPrAllowanceRemaining: activation.subscription.monthlyPrAllowanceRemaining,
        },
        baselineRun: {
          id: activation.baselineRun.id,
          status: activation.baselineRun.status,
          delta: activation.baselineRun.delta
            ? deltaPresentation(activation.baselineRun.delta)
            : null,
          proposal: activation.baselineRun.proposal,
          notification: activation.baselineRun.notification,
        },
        findings: task.result.findings,
      });
    } catch (err) {
      if (task.input.quoteId) {
        await handleExecutionFailure(task.input.quoteId, "platform_failure");
      }
      return failTask(
        task,
        sm,
        "analysis_failed",
        err instanceof Error ? err.message : "Repo Guard activation failed.",
        "orchestrator"
      );
    }
  }

  return failTask(task, sm, "unsupported", "Unsupported task type.");
}

export async function submitA2ATask(type: A2ATaskType, input: A2ATaskInput): Promise<A2ATaskRecord> {
  let task = buildInitialTask(type, input, repoFromUrl(input.repoUrl, input.branch));
  const sm = new A2ATaskStateMachine(task.transitions);
  await saveA2ATask(task);

  const analysis = await runAnalysisPhase(task, sm);
  if (!("findings" in analysis)) return analysis;
  const { task: analyzedTask, findings } = analysis;
  task = analyzedTask;

  try {
    task = await assertBoundMaintenanceContract(task, findings);
  } catch (error) {
    return failTask(
      task,
      sm,
      "analysis_failed",
      error instanceof Error ? error.message : "Maintenance contract validation failed.",
      "orchestrator"
    );
  }

  if (type === "repository.analysis") {
    return completeTask(task, sm, task.result);
  }

  task = await ensurePayment(task, sm, findings);
  if (
    task.status === "awaiting_payment" ||
    task.status === "quote_required" ||
    A2A_FAILURE_STATUSES.includes(task.status)
  ) {
    return task;
  }

  return executeChanges(task, sm, findings);
}

export async function fundA2ATask(
  taskId: string,
  input: {
    quoteId?: string;
    paymentReference?: string;
    payer?: string;
    idempotencyKey?: string;
    paymentSignature?: string;
  },
  request?: Request
): Promise<A2ATaskRecord> {
  const existing = await getA2ATask(taskId);
  if (!existing) throw new Error("Task not found.");

  const existingLock = await getA2aFundLock(taskId);
  if (existingLock?.executionQueued && A2A_FUNDED_OR_EXECUTING_STATUSES.has(existing.status)) {
    return existing;
  }

  if (A2A_FUNDED_OR_EXECUTING_STATUSES.has(existing.status) && existing.status !== "payment_failed") {
    return existing;
  }

  if (!A2A_FUNDABLE_STATUSES.has(existing.status)) {
    throw new Error(`Task is not awaiting payment (status=${existing.status}).`);
  }

  const quoteId = input.quoteId ?? quoteIdForTask(existing);
  if (!quoteId) throw new Error("quoteId is required.");

  const quote = await getBoundQuote(quoteId);
  if (!quote) throw new Error("Quote not found.");

  const order = await getOkxOrderByA2aTask(taskId);
  const paymentReference = input.paymentReference ?? quote.paymentReference;
  const payer = input.payer ?? quote.payer ?? order?.payer;

  let fundedQuote = quote;
  const verified = await validateVerifiedQuoteForA2aFund({
    task: existing,
    quote,
    order,
    expectedQuoteId: quoteId,
    expectedPayer: payer,
    expectedPaymentReference: paymentReference,
  });

  if (!verified.ok) {
    const proof = request ? paymentProofFromRequest(request, { ...input, quoteId }) : null;
    const paymentSignature =
      input.paymentSignature ??
      proof?.paymentSignature ??
      (process.env.REPODIET_X402_TEST_SECRET
        ? signTestPaymentPayload({
            quoteId,
            paymentReference:
              input.paymentReference ?? `0xtest_${Date.now().toString(16)}_${quoteId.slice(-8)}`,
            payer: payer ?? "0x0000000000000000000000000000000000000001",
            amountMicro: quote.amountMicro,
            nonce: quote.nonce,
            requestHash: quote.requestHash,
          }) ?? undefined
        : undefined);

    if (!paymentSignature) {
      const sm = new A2ATaskStateMachine(existing.transitions);
      return failTask(
        existing,
        sm,
        "payment_failed",
        verified.reason ?? "Payment required before funding."
      );
    }

    const idempotencyKey = input.idempotencyKey ?? `idem_${taskId}_${quoteId}`;
    const funded = await verifyAndFundQuote({
      quoteId,
      paymentReference:
        input.paymentReference ?? `0xtest_${Date.now().toString(16)}_${quoteId.slice(-8)}`,
      payer: payer ?? "0x0000000000000000000000000000000000000001",
      amountMicro: quote.amountMicro,
      currency: quote.currency,
      network: quote.network,
      recipient: quote.recipient,
      nonce: quote.nonce,
      idempotencyKey,
      paymentSignature,
      taskId,
    });

    if (!funded.ok) {
      const sm = new A2ATaskStateMachine(existing.transitions);
      return failTask(existing, sm, "payment_failed", funded.reason ?? "Payment failed.");
    }

    if (funded.existingTaskId && funded.existingTaskId !== taskId) {
      throw new Error(`Duplicate payment — existing task ${funded.existingTaskId}`);
    }

    fundedQuote = funded.quote ?? quote;
  } else if (!verified.payment) {
    const sm = new A2ATaskStateMachine(existing.transitions);
    return failTask(existing, sm, "payment_failed", "Verified payment missing.");
  } else {
    fundedQuote = quote;
    if (!verified.payment.taskId) {
      await savePaymentRecord({ ...verified.payment, taskId });
    }
  }

  const lock = await claimA2aFundLock({
    taskId,
    quoteId: fundedQuote.quoteId,
    paymentReference: fundedQuote.paymentReference ?? paymentReference ?? "",
    fundedAt: fundedQuote.fundedAt ?? new Date().toISOString(),
    payer: fundedQuote.payer,
  });

  if (!lock.claimed) {
    const current = await getA2ATask(taskId);
    if (current) return current;
    throw new Error("Funding already in progress for this task.");
  }

  const lockToken = lock.lockToken;
  if (!lockToken) {
    throw new Error("Fund lock token missing after claim.");
  }

  const boundPaymentReference = fundedQuote.paymentReference ?? paymentReference;
  if (!boundPaymentReference) {
    await releaseA2aFundLockIfToken(taskId, lockToken);
    const sm = new A2ATaskStateMachine(existing.transitions);
    return failTask(existing, sm, "payment_failed", "Payment reference missing after funding.");
  }

  let task = await updateA2ATask(taskId, {
    input: {
      ...existing.input,
      quoteId,
      paymentReference: boundPaymentReference,
      ...(payer ? { payer } : {}),
    },
    status: existing.status === "payment_failed" ? "awaiting_payment" : existing.status,
    error: undefined,
  });
  if (!task) throw new Error("Failed to update task.");

  await updateBoundQuote(fundedQuote.quoteId, { a2aTaskId: taskId, taskId });
  if (order) {
    await updateOkxOrder(order.orderId, {
      quoteId: fundedQuote.quoteId,
      payer: fundedQuote.payer,
      amountMicro: fundedQuote.amountMicro,
      status: "funded",
    });
  }

  const sm = new A2ATaskStateMachine(task.transitions);
  const findings = await loadFindings(task);
  const entitled = await requireEntitlement({
    quoteId,
    taskId,
    repository: fundedQuote.repository,
    branch: fundedQuote.branch,
    commitSha: fundedQuote.commitSha,
    findingIds: fundedQuote.findingIds,
    operation: fundedQuote.operation,
    contractDigest: task.input.contractDigest,
  });
  if (!entitled.ok) {
    await releaseA2aFundLockIfToken(taskId, lockToken);
    return failTask(task, sm, "payment_failed", entitled.reason ?? "Entitlement lock failed.");
  }

  sm.emit("funded", "orchestrator", boundPaymentReference);
  // Bind OKX-native escrow reference into settlement evidence when provided on the order.
  if (order?.escrowReference) {
    task = {
      ...task,
      result: {
        ...task.result,
        settlement: {
          ...task.result.settlement,
          escrowReference: order.escrowReference,
        },
      },
    };
  }
  await syncTask(task, sm);
  const marked = await markA2aFundExecutionQueued(taskId, lockToken, {
    quoteId: fundedQuote.quoteId,
    paymentReference: boundPaymentReference,
    fundedAt: fundedQuote.fundedAt ?? new Date().toISOString(),
    payer: fundedQuote.payer,
  });
  if (!marked) {
    const current = await getA2ATask(taskId);
    if (current) return current;
    throw new Error("Failed to mark execution dispatched for funded task.");
  }

  return executeChanges(task, sm, findings);
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
    const patchKitId = task.result.changes?.patchKitId ?? task.result.changes?.patchId;
    const storedPatchKit = patchKitId ? await getStoredPatchKit(patchKitId) : undefined;
    let patchKit = storedPatchKit?.payload;

    if (patchKit?.patchValidation?.status === "pending_sandbox") {
      patchKit = await waitForPatchKitSandbox(patchKit);
    }
    if (patchKit) {
      patchKit = withRefreshedVerificationGates(patchKit, findings);
    }

    if (!patchKit || !patchKitHasDeliverableChanges(patchKit)) {
      throw new Error(
        patchKit
          ? (patchKitDeliveryBlocker(patchKit) ??
            "Verified cleanup bundle is missing. Regenerate cleanup scope and try again.")
          : "Verified cleanup bundle is missing. Regenerate cleanup scope and try again."
      );
    }

    const pr = await createCleanupPullRequest({
      repoUrl: task.input.repoUrl,
      branch: task.input.branch,
      findings,
      patchKit,
      demo: task.input.demo,
      githubToken: task.input.githubToken,
      cleanupBranch:
        typeof task.result.greenPrExecution?.branchName === "string"
          ? task.result.greenPrExecution.branchName
          : undefined,
    });

    return monitorTaskPullRequestDelivery({
      task: current,
      prNumber: pr.data.pullRequest.number,
      prUrl: pr.data.pullRequest.url,
      branch: pr.data.repo.cleanupBranch,
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
    maintenanceContract:
      task.result.maintenanceContract ??
      (task.input.contractId && task.input.contractDigest
        ? {
            contractId: task.input.contractId,
            contractDigest: task.input.contractDigest,
            status: "accepted",
          }
        : {}),
    prDelivery: task.result.prDelivery ?? {},
    attestation: task.result.attestation ?? {},
    transitions: task.transitions,
    limitations: task.limitations,
    error: task.error,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  };
}
