import type { A2ATaskRecord } from "@/lib/a2a/types";
import { A2ATaskStateMachine } from "@/lib/a2a/task-state-machine";
import { saveA2ATask } from "@/lib/a2a/task-store";
import { deliverTaskCallback, persistTask } from "@/lib/a2a/callbacks";
import {
  buildDeliveryReceiptChecks,
  inspectPullRequestChecks,
} from "@/lib/github/pr-check-monitor";
import type { PrDeliveryMonitorRecord } from "@/lib/github/pr-check-types";
import {
  hashPatchContent,
  hashVerification,
  signExecutionReceipt,
  type ExecutionReceipt,
} from "@/lib/operator/sign-receipt";
import {
  canonicalDigest,
  assertSigningIdentitySeparation,
  createGreenPrAttestation,
  getMaintenanceContract,
  independentlyVerifyGreenPr,
  markMaintenanceContractDelivered,
  saveGreenPrAttestation,
  saveGreenPrReceipt,
  sha256Digest,
  signGreenPrReceipt,
  signerFromEnvironment,
  type AuthorizedExecutorDispatch,
  type CommandResult,
  type IndependentVerificationInput,
} from "@/lib/green-pr";
import { getBoundQuote, getPaymentByQuoteId } from "@/lib/payment/payment-store";

function normalizedPaths(values: string[]): string[] {
  return [...new Set(values.map((value) => value.replace(/\\/g, "/").replace(/^\.\//, "")))]
    .filter(Boolean)
    .sort();
}

function plannedDeletePaths(unifiedDiff?: string): string[] {
  if (!unifiedDiff) return [];
  const deleted: string[] = [];
  for (const block of unifiedDiff.split(/^diff --git /m).slice(1)) {
    if (!/^a\/.+ b\/.+/m.test(block) || !/^deleted file mode /m.test(block)) continue;
    const match = block.match(/^a\/(.+?) b\/.+$/m);
    if (match?.[1]) deleted.push(match[1]);
  }
  return normalizedPaths(deleted);
}

export function validateCurrentPullRequestScope(
  task: A2ATaskRecord,
  monitor: PrDeliveryMonitorRecord
): string | undefined {
  const pinnedCommit = task.repository.commitSha ?? task.input.commitSha;
  if (pinnedCommit && monitor.baseSha !== pinnedCommit) {
    return `pull_request_base_changed: expected ${pinnedCommit}, received ${monitor.baseSha}`;
  }

  const expectedPaths = normalizedPaths(
    task.approval?.changes.map((change) => change.path) ??
      task.result.changes?.changedFiles ??
      []
  );
  const actualPaths = normalizedPaths(monitor.changedFiles.map((file) => file.path));
  if (actualPaths.length === 0) return "pull_request_has_no_changes";
  if (
    expectedPaths.length === 0 ||
    expectedPaths.length !== actualPaths.length ||
    expectedPaths.some((path, index) => path !== actualPaths[index])
  ) {
    return `pull_request_scope_mismatch: expected [${expectedPaths.join(", ")}], received [${actualPaths.join(", ")}]`;
  }

  const expectedDeletes = plannedDeletePaths(task.result.changes?.unifiedDiff);
  for (const path of expectedDeletes) {
    const file = monitor.changedFiles.find((entry) => entry.path === path);
    if (file?.status !== "removed") {
      return `pull_request_operation_mismatch: expected ${path} to be removed`;
    }
  }
  return undefined;
}

function phaseCommandResults(
  phase: unknown,
  requiredCommands: string[]
): CommandResult[] {
  const phaseRecord = phase && typeof phase === "object" ? phase as Record<string, unknown> : {};
  const checks = Array.isArray(phaseRecord.checks)
    ? phaseRecord.checks.filter((entry): entry is Record<string, unknown> =>
        Boolean(entry && typeof entry === "object"))
    : [];
  return requiredCommands.map((command) => {
    const match = checks.find((entry) => entry.command === command || entry.name === command);
    const rawStatus = typeof match?.status === "string" ? match.status : "unknown";
    const status: CommandResult["status"] =
      rawStatus === "passed" || rawStatus === "failed" || rawStatus === "skipped" ||
      rawStatus === "blocked"
        ? rawStatus
        : "unknown";
    return {
      command,
      status,
      diagnostics: match
        ? [match.stderrSummary, match.stdoutSummary].filter(
            (value): value is string => typeof value === "string" && Boolean(value.trim())
          )
        : [],
    };
  });
}

async function finalizeContractedGreenPr(input: {
  task: A2ATaskRecord;
  monitor: PrDeliveryMonitorRecord;
  prUrl: string;
  prNumber: number;
}): Promise<{
  receipt: Record<string, unknown>;
  attestation: Record<string, unknown>;
}> {
  const { contractId, contractDigest } = input.task.input;
  if (!contractId || !contractDigest) throw new Error("maintenance_contract_binding_incomplete");
  const contractRecord = await getMaintenanceContract(contractId);
  if (!contractRecord || contractRecord.contractDigest !== contractDigest) {
    throw new Error("maintenance_contract_not_found_or_changed");
  }
  const receiptSigner = signerFromEnvironment("RECEIPT");
  const attestationSigner = signerFromEnvironment("GREEN_PR");
  if (!receiptSigner) throw new Error("green_pr_receipt_signing_key_unavailable");
  if (!attestationSigner) throw new Error("green_pr_attestation_signing_key_unavailable");
  assertSigningIdentitySeparation(receiptSigner, attestationSigner);
  const quoteId = input.task.input.quoteId;
  if (!quoteId) throw new Error("green_pr_quote_missing");
  const quote = await getBoundQuote(quoteId);
  const payment = await getPaymentByQuoteId(quoteId);
  if (!quote || quote.contractDigest !== contractDigest) {
    throw new Error("green_pr_quote_contract_mismatch");
  }
  if (!payment || payment.lifecycleStatus !== "funded") {
    throw new Error("green_pr_verified_payment_missing");
  }
  const executorDispatch = input.task.result.greenPrExecution as
    | AuthorizedExecutorDispatch
    | undefined;
  if (!executorDispatch) throw new Error("green_pr_execution_manifest_missing");

  const receiptId = `receipt_green_${sha256Digest(
    `${contractDigest}:${input.task.id}:${input.monitor.patchCommitSha}`
  ).slice(7, 27)}`;
  const receipt = signGreenPrReceipt(
    {
      receiptVersion: "1",
      receiptId,
      contractDigest,
      aspId: contractRecord.contract.commercialTerms.aspId,
      serviceId: contractRecord.contract.commercialTerms.serviceId,
      quoteId,
      taskId: input.task.id,
      paymentReference: payment.paymentReference,
      repository: `${contractRecord.contract.repository.owner}/${contractRecord.contract.repository.name}`,
      sourceCommit: contractRecord.contract.repository.sourceCommit,
      amount: contractRecord.contract.commercialTerms.amount,
      asset: contractRecord.contract.commercialTerms.asset,
      network: contractRecord.contract.commercialTerms.network,
      payer: payment.payer,
      recipient: contractRecord.contract.commercialTerms.recipient,
      idempotencyKey: payment.idempotencyKey,
      deliveryId: `green_pr_delivery_${input.task.id}_${input.prNumber}`,
      issuedAt: new Date().toISOString(),
    },
    receiptSigner
  );
  await saveGreenPrReceipt(receipt);

  const requiredCommands = contractRecord.contract.verificationPolicy.requiredCommands;
  const verificationInput: IndependentVerificationInput = {
    contractRecord,
    contractDigest,
    repository: `${input.monitor.owner}/${input.monitor.repo}`,
    sourceCommit: input.monitor.sourceCommitSha,
    patchCommit: input.monitor.patchCommitSha,
    pullRequest: {
      url: input.prUrl,
      number: input.prNumber,
      headCommit: input.monitor.headSha,
    },
    executorDispatch,
    baselineCommands: phaseCommandResults(
      input.task.result.verification?.baseline,
      requiredCommands
    ),
    patchedCommands: phaseCommandResults(
      input.task.result.verification?.patched,
      requiredCommands
    ),
    baselineDiagnostics: input.monitor.baselineComparisons
      .map((entry) => entry.baselineDiagnostic)
      .filter((value): value is string => Boolean(value)),
    patchedDiagnostics: input.monitor.baselineComparisons
      .map((entry) => entry.prDiagnostic)
      .filter((value): value is string => Boolean(value)),
    githubChecks: input.monitor.checks.map((entry) => ({
      name: entry.checkName,
      status:
        entry.conclusion === "success"
          ? "passed"
          : entry.conclusion === "skipped"
            ? "skipped"
            : entry.conclusion === null
              ? "unknown"
              : "failed",
      url: entry.detailsUrl,
    })),
    providerChecks: input.monitor.vercelProjects?.projects.map((entry) => ({
      name: entry.name,
      status:
        entry.conclusion === "success"
          ? "passed"
          : entry.conclusion === "skipped"
            ? "skipped"
            : entry.conclusion === null
              ? "unknown"
              : "failed",
      url: entry.deploymentUrl,
    })) ?? [],
    receipt,
    trustedReceiptKeys: { [receiptSigner.keyId]: receiptSigner.publicKeyPem },
  };
  const decision = independentlyVerifyGreenPr(verificationInput);
  if (!decision.contractSatisfied) {
    const failed = decision.checks
      .filter((entry) => !entry.passed)
      .map((entry) => `${entry.name}:${entry.reason ?? "failed"}`)
      .join(",");
    throw new Error(`green_pr_contract_not_satisfied:${failed}`);
  }
  const attestation = createGreenPrAttestation({
    verificationInput,
    decision,
    receipt,
    tools: [
      {
        name: "repodiet-green-pr-verifier",
        version: "1.0.0",
        configurationDigest: canonicalDigest({
          verificationPolicy: contractRecord.contract.verificationPolicy,
          acceptancePolicy: contractRecord.contract.acceptancePolicy,
        }),
      },
    ],
    signer: attestationSigner,
  });
  await saveGreenPrAttestation(attestation);
  await markMaintenanceContractDelivered({
    contractId,
    contractDigest,
    pullRequestUrl: input.prUrl,
    receiptId,
    attestationId: attestation.attestationId,
  });
  return {
    receipt: receipt as unknown as Record<string, unknown>,
    attestation: {
      attestationId: attestation.attestationId,
      statementDigest: attestation.statementDigest,
      signature: attestation.signatureMetadata,
      verificationUrl: `/api/attestations/${attestation.attestationId}`,
      publicProofUrl: `/proof/green-pr/${attestation.attestationId}`,
    },
  };
}

async function syncDeliveryTask(
  task: A2ATaskRecord,
  sm: A2ATaskStateMachine,
  status: A2ATaskRecord["status"],
  patch: Partial<A2ATaskRecord> = {}
): Promise<A2ATaskRecord> {
  sm.emit(status, "ci_monitor");
  const updated: A2ATaskRecord = {
    ...task,
    ...patch,
    status,
    transitions: sm.cloneTransitions(),
    updatedAt: new Date().toISOString(),
  };
  return persistTask(updated);
}

export async function monitorTaskPullRequestDelivery(input: {
  task: A2ATaskRecord;
  prNumber: number;
  prUrl: string;
  branch: string;
  installationId?: number;
}): Promise<A2ATaskRecord> {
  const sm = new A2ATaskStateMachine(input.task.transitions);
  let current = await syncDeliveryTask(input.task, sm, "monitoring_checks");
  const contractedDelivery = Boolean(
    input.task.input.contractId || input.task.input.contractDigest
  );

  const monitor = await inspectPullRequestChecks({
    owner: input.task.repository.owner,
    repo: input.task.repository.name,
    prNumber: input.prNumber,
    taskId: input.task.id,
    sourceCommitSha: input.task.repository.commitSha,
    patchCommitSha: undefined,
    installationId: input.installationId,
    poll: true,
    maxPollAttempts: 10,
    pollDelayMs: 5000,
  });

  const receiptChecks = buildDeliveryReceiptChecks(monitor);
  const scopeError = validateCurrentPullRequestScope(current, monitor);
  const changedPaths = normalizedPaths(monitor.changedFiles.map((file) => file.path));
  const patchEvidence = {
    baseSha: monitor.baseSha,
    headSha: monitor.headSha,
    files: [...monitor.changedFiles]
      .map((file) => ({
        path: file.path,
        status: file.status,
        previousPath: file.previousPath,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        blobSha: file.blobSha,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
  const effectiveDeliveryReady = monitor.deliveryReady && !scopeError;
  const effectiveReceiptChecks = scopeError
    ? {
        ...receiptChecks,
        deliveryReady: false,
        deliveryStatus: "owner_action_required" as const,
        unresolvedOwnerActions: [
          ...receiptChecks.unresolvedOwnerActions,
          scopeError,
        ],
      }
    : receiptChecks;
  const signed = signExecutionReceipt({
    taskId: input.task.id,
    repository: `${input.task.repository.owner}/${input.task.repository.name}`,
    commitSha: input.task.repository.commitSha ?? monitor.sourceCommitSha,
    findingIds: input.task.input.findingIds ?? [],
    patchHash: hashPatchContent(JSON.stringify(patchEvidence)),
    verificationHash: hashVerification({
      headSha: monitor.headSha,
      checks: effectiveReceiptChecks,
    }),
    status: effectiveDeliveryReady ? "verified" : "failed",
    quoteId: input.task.input.quoteId,
    paymentReference: input.task.input.paymentReference,
    timestamp: new Date().toISOString(),
    pullRequestUrl: input.prUrl,
    patchCommitSha: monitor.headSha,
    changedPaths,
  } satisfies ExecutionReceipt);

  const receipt = {
    ...signed.signedReceipt,
    signature: signed.signature,
    signedBy: signed.signedBy,
    deliveryReady: effectiveDeliveryReady,
    prDelivery: effectiveReceiptChecks,
    scopeValidation: {
      satisfied: !scopeError,
      error: scopeError,
      expectedPaths: normalizedPaths(
        current.approval?.changes.map((change) => change.path) ??
          current.result.changes?.changedFiles ??
          []
      ),
      changedPaths,
    },
  };

  let result = {
    ...current.result,
    pullRequest: {
      url: input.prUrl,
      number: input.prNumber,
      branch: input.branch,
      title: current.result.pullRequest?.title,
      headCommit: monitor.headSha,
    },
    receipt: contractedDelivery
      ? { status: "pending_green_pr_attestation" }
      : receipt as Record<string, unknown>,
    prDelivery: monitor as unknown as Record<string, unknown>,
    attestation: current.result.attestation,
    maintenanceOutcome: {
      kind: "bounded_repository_cleanup" as const,
      headline: `${changedPaths.length} bounded repository change${changedPaths.length === 1 ? "" : "s"} delivered for review`,
      sourceCommit: monitor.sourceCommitSha,
      canonicalizations: [],
      changedPaths,
      editedPaths: monitor.changedFiles
        .filter((file) => file.status === "modified" || file.status === "renamed")
        .map((file) => file.path)
        .sort(),
      deletedPaths: monitor.changedFiles
        .filter((file) => file.status === "removed")
        .map((file) => file.path)
        .sort(),
      addedPaths: monitor.changedFiles
        .filter((file) => file.status === "added" || file.status === "copied")
        .map((file) => file.path)
        .sort(),
      verificationStatus: effectiveDeliveryReady ? "verified" : "blocked",
      deliveryState: "delivered" as const,
      evidenceStatement:
        "Derived from the current GitHub pull request head and its exact changed-file set; no architecture-level claim is made.",
    },
  };

  if (scopeError) {
    return syncDeliveryTask(current, sm, "owner_action_required", {
      result,
      error: scopeError,
      completedAt: undefined,
    });
  }

  if (monitor.deliveryReady) {
    if (contractedDelivery) {
      try {
        const proof = await finalizeContractedGreenPr({
          task: current,
          monitor,
          prUrl: input.prUrl,
          prNumber: input.prNumber,
        });
        result = { ...result, receipt: proof.receipt, attestation: proof.attestation };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Green PR proof generation failed.";
        return syncDeliveryTask(current, sm, "owner_action_required", {
          result: {
            ...result,
            receipt: { status: "blocked", reason: message },
            attestation: { status: "blocked", reason: message },
          },
          error: message,
          completedAt: new Date().toISOString(),
        });
      }
    }
    sm.emit("delivery_ready", "ci_monitor");
    const finalized: A2ATaskRecord = {
      ...current,
      status: "delivery_ready",
      result,
      transitions: sm.cloneTransitions(),
      updatedAt: new Date().toISOString(),
      error: undefined,
      // Not terminal — buyer must inspect, accept, then escrow releases.
      completedAt: undefined,
    };
    await saveA2ATask(finalized);
    await deliverTaskCallback(finalized);

    // Only OKX marketplace orders enter the escrow delivery lifecycle. Direct-site
    // payments remain delivery_ready until the buyer explicitly accepts here.
    if (finalized.input.purchaseChannel !== "direct_site") {
      try {
        const { submitA2aDeliveryEvidence } = await import("@/lib/a2a/settlement-lifecycle");
        return await submitA2aDeliveryEvidence(finalized.id);
      } catch {
        return finalized;
      }
    }
    return finalized;
  }

  const failureStatus =
    monitor.deliveryState === "owner_action_required"
      ? "owner_action_required"
      : monitor.deliveryState === "diagnosis_ready"
        ? "diagnosis_ready"
        : "checks_failed";

  const primaryDiagnosis = monitor.diagnoses[0];
  const error =
    primaryDiagnosis?.firstActionableError ??
    `Required provider checks failed for pull request #${input.prNumber}.`;

  return syncDeliveryTask(current, sm, failureStatus, {
    result,
    error,
    completedAt: new Date().toISOString(),
  });
}

export async function reconcileTaskPullRequestDelivery(
  task: A2ATaskRecord
): Promise<A2ATaskRecord> {
  const pullRequest = task.result.pullRequest;
  if (!pullRequest?.url || !pullRequest.number || !pullRequest.branch) {
    throw new Error("pull_request_delivery_evidence_missing");
  }
  return monitorTaskPullRequestDelivery({
    task,
    prNumber: pullRequest.number,
    prUrl: pullRequest.url,
    branch: pullRequest.branch,
  });
}

export function formatPrDeliverySummary(monitor: PrDeliveryMonitorRecord): string {
  const failed = monitor.checks.filter(
    (check) => check.required && check.conclusion === "failure"
  );
  if (failed.length === 0) return "All required checks passed.";
  return failed
    .map((check) => {
      const diagnosis = monitor.diagnoses.find((entry) =>
        entry.firstActionableError.toLowerCase().includes(check.checkName.toLowerCase())
      );
      return `${check.checkName}: ${diagnosis?.firstActionableError ?? "failed"}`;
    })
    .join(" | ");
}
