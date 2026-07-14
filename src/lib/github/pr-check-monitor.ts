import { resolveAspGitHubToken } from "@/lib/asp/github-access";
import { retrieveGitHubActionsEvidence } from "@/lib/github/check-log-retrieval";
import { GitHubClient } from "@/lib/github/github-client";
import {
  getPrDeliveryMonitor,
  savePrDeliveryMonitor,
} from "@/lib/github/pr-delivery-store";
import type {
  CheckFailureDiagnosis,
  CheckProvider,
  CheckRunConclusion,
  CleanupCausedDetermination,
  PrCheckRecord,
  PrDeliveryMonitorRecord,
  PrDeliveryReceiptChecks,
} from "@/lib/github/pr-check-types";
import {
  aggregateCleanupCaused,
  compareBaselineAndPrChecks,
  diagnoseChecks,
  extractCheckDiagnostic,
  isFailedConclusion,
  isPendingRequiredCheck,
  isTerminalCheck,
} from "@/lib/workflow/check-baseline-comparison";
import {
  detectVercelProjects,
  isVercelCheckName,
  mapCheckStatus,
  parseVercelEvidence,
} from "@/lib/vercel/deployment-diagnostics";

const CONFIG_CLASSIFICATIONS = new Set([
  "missing_environment_variable",
  "invalid_environment_variable",
  "provider_configuration_error",
  "wrong_root_directory",
  "wrong_build_command",
  "wrong_framework_configuration",
  "duplicate_project_integration",
  "preview_deployment_restricted",
  "permission_failure",
]);

function inferProvider(check: {
  name: string;
  app?: { slug?: string; name?: string };
}): CheckProvider {
  if (isVercelCheckName(check.name) || check.app?.slug === "vercel") return "vercel";
  if (check.app?.slug) return "github_actions";
  return "other";
}

function isCheckRequired(checkName: string, requiredContexts: string[]): boolean {
  if (requiredContexts.length === 0) return true;
  const lower = checkName.toLowerCase();
  return requiredContexts.some(
    (context) =>
      context.toLowerCase() === lower ||
      lower.includes(context.toLowerCase()) ||
      context.toLowerCase().includes(lower)
  );
}

function mapRawChecks(
  raw: Awaited<ReturnType<GitHubClient["listCommitCheckRuns"]>>,
  requiredContexts: string[]
): PrCheckRecord[] {
  return raw.map((check) => {
    const mapped = mapCheckStatus(check.status, check.conclusion);
    return {
      checkName: check.name,
      provider: inferProvider(check),
      status: mapped.status,
      conclusion: mapped.conclusion,
      required: isCheckRequired(check.name, requiredContexts),
      detailsUrl: check.details_url,
      startedAt: check.started_at,
      completedAt: check.completed_at,
      externalId: check.external_id,
      checkRunId: check.id,
    };
  });
}

async function collectEvidence(input: {
  client: GitHubClient;
  owner: string;
  repo: string;
  headSha: string;
  failedChecks: PrCheckRecord[];
  rawChecks: Awaited<ReturnType<GitHubClient["listCommitCheckRuns"]>>;
  cleanupCausedByCheck: Record<string, CleanupCausedDetermination>;
}): Promise<Record<string, Parameters<typeof diagnoseChecks>[0]["evidenceByCheck"][string]>> {
  const evidence: Record<string, Parameters<typeof diagnoseChecks>[0]["evidenceByCheck"][string]> =
    {};

  for (const check of input.failedChecks) {
    const raw = input.rawChecks.find((entry) => entry.id === check.checkRunId);
    const outputTitle = raw?.output?.title;
    const outputSummary = raw?.output?.summary;
    const outputText = raw?.output?.text;

    let logExcerpt = extractCheckDiagnostic(outputSummary, outputText);
    let logsAvailable = Boolean(logExcerpt);

    if (check.provider === "vercel") {
      const parsed = parseVercelEvidence(outputSummary, outputText);
      logExcerpt = parsed.firstError ?? logExcerpt;
      logsAvailable = Boolean(logExcerpt);
    } else if (check.provider === "github_actions") {
      const actionsEvidence = await retrieveGitHubActionsEvidence({
        client: input.client,
        owner: input.owner,
        repo: input.repo,
        headSha: input.headSha,
        checkName: check.checkName,
      });
      logExcerpt = actionsEvidence.logExcerpt ?? logExcerpt;
      logsAvailable = actionsEvidence.logsAvailable || logsAvailable;
    }

    evidence[check.checkName] = {
      outputTitle,
      outputSummary,
      outputText,
      logExcerpt,
      logsAvailable,
      cleanupCausedThis: input.cleanupCausedByCheck[check.checkName],
    };
  }

  return evidence;
}

function resolveDeliveryState(input: {
  checks: PrCheckRecord[];
  diagnoses: CheckFailureDiagnosis[];
  ownerActions: string[];
}): PrDeliveryMonitorRecord["deliveryState"] {
  const pendingRequired = input.checks.some((check) => isPendingRequiredCheck(check));
  if (pendingRequired) return "monitoring_checks";

  const failedRequired = input.checks.filter(
    (check) => check.required && isFailedConclusion(check.conclusion)
  );
  if (failedRequired.length === 0) return "delivery_ready";

  if (input.ownerActions.length > 0) return "owner_action_required";
  if (input.diagnoses.some((entry) => entry.classification === "cleanup_regression")) {
    return "checks_failed";
  }
  return "diagnosis_ready";
}

export async function inspectPullRequestChecks(input: {
  owner: string;
  repo: string;
  prNumber: number;
  taskId?: string;
  sourceCommitSha?: string;
  patchCommitSha?: string;
  installationId?: number;
  poll?: boolean;
  maxPollAttempts?: number;
  pollDelayMs?: number;
}): Promise<PrDeliveryMonitorRecord> {
  const token = await resolveAspGitHubToken({
    owner: input.owner,
    repo: input.repo,
    installationId: input.installationId,
  });
  const client = new GitHubClient(token);
  const pr = await client.getPullRequest(input.owner, input.repo, input.prNumber);
  const requiredContexts = await client.getBranchRequiredCheckContexts(
    input.owner,
    input.repo,
    pr.baseRef
  );

  const existing = await getPrDeliveryMonitor(input.owner, input.repo, input.prNumber);
  const pollAttempts = input.poll ? (input.maxPollAttempts ?? 8) : 1;
  const pollDelayMs = input.pollDelayMs ?? 4000;

  let checks: PrCheckRecord[] = [];
  let rawChecks: Awaited<ReturnType<GitHubClient["listCommitCheckRuns"]>> = [];

  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    rawChecks = await client.listCommitCheckRuns(input.owner, input.repo, pr.headSha);
    checks = mapRawChecks(rawChecks, requiredContexts);
    const pending = checks.some((check) => check.required && !isTerminalCheck(check));
    if (!pending || attempt === pollAttempts - 1) break;
    await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
  }

  const baselineRaw = await client.listCommitCheckRuns(input.owner, input.repo, pr.baseSha);
  const baselineChecks = mapRawChecks(baselineRaw, requiredContexts);

  const preliminaryComparisons = compareBaselineAndPrChecks({
    baselineChecks,
    prChecks: checks,
    baselineDiagnoses: [],
    prDiagnoses: [],
  });

  const cleanupCausedByCheck = Object.fromEntries(
    preliminaryComparisons.map((entry) => [entry.checkName, entry.cleanupCausedThis])
  ) as Record<string, CleanupCausedDetermination>;

  const failedChecks = checks.filter(
    (check) => check.required && isFailedConclusion(check.conclusion)
  );
  const evidenceByCheck = await collectEvidence({
    client,
    owner: input.owner,
    repo: input.repo,
    headSha: pr.headSha,
    failedChecks,
    rawChecks,
    cleanupCausedByCheck,
  });

  const diagnoses = diagnoseChecks({ failedChecks, evidenceByCheck });
  const baselineFailed = baselineChecks.filter((check) =>
    isFailedConclusion(check.conclusion)
  );
  const baselineEvidence = Object.fromEntries(
    baselineFailed.map((check) => {
      const raw = baselineRaw.find((entry) => entry.id === check.checkRunId);
      return [
        check.checkName,
        {
          outputTitle: raw?.output?.title,
          outputSummary: raw?.output?.summary,
          outputText: raw?.output?.text,
          logExcerpt: extractCheckDiagnostic(raw?.output?.summary, raw?.output?.text),
          logsAvailable: Boolean(raw?.output?.summary || raw?.output?.text),
          cleanupCausedThis: false as const,
        },
      ];
    })
  );
  const baselineDiagnoses = diagnoseChecks({
    failedChecks: baselineFailed,
    evidenceByCheck: baselineEvidence,
  });

  const baselineComparisons = compareBaselineAndPrChecks({
    baselineChecks,
    prChecks: checks,
    baselineDiagnoses,
    prDiagnoses: diagnoses,
  });

  for (const diagnosis of diagnoses) {
    const comparison = baselineComparisons.find((entry) =>
      failedChecks.some((check) => check.checkName === entry.checkName)
    );
    if (comparison) {
      diagnosis.cleanupCausedThis = comparison.cleanupCausedThis;
    }
  }

  const vercelProjects = detectVercelProjects({
    checks,
    repositoryName: input.repo,
  });

  const ownerActions: string[] = [];
  if (vercelProjects?.ownerAction) ownerActions.push(vercelProjects.ownerAction);
  for (const diagnosis of diagnoses) {
    if (CONFIG_CLASSIFICATIONS.has(diagnosis.classification)) {
      ownerActions.push(diagnosis.recommendedAction);
    }
  }

  const deliveryState = resolveDeliveryState({ checks, diagnoses, ownerActions });
  const deliveryReady = deliveryState === "delivery_ready";

  const now = new Date().toISOString();
  const record: PrDeliveryMonitorRecord = {
    taskId: input.taskId ?? existing?.taskId,
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
    prUrl: pr.url,
    headSha: pr.headSha,
    baseSha: pr.baseSha,
    sourceCommitSha: input.sourceCommitSha ?? existing?.sourceCommitSha ?? pr.baseSha,
    patchCommitSha: input.patchCommitSha ?? existing?.patchCommitSha ?? pr.headSha,
    branch: pr.headRef,
    deliveryState,
    checks,
    diagnoses,
    vercelProjects,
    baselineComparisons,
    deliveryReady,
    ownerActions: [...new Set(ownerActions)],
    lastPolledAt: now,
    pollCount: (existing?.pollCount ?? 0) + 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await savePrDeliveryMonitor(record);
  return record;
}

export function buildDeliveryReceiptChecks(
  record: PrDeliveryMonitorRecord
): PrDeliveryReceiptChecks {
  return {
    requiredChecks: record.checks.filter((check) => check.required),
    finalConclusions: record.checks.map((check) => ({
      checkName: check.checkName,
      conclusion: check.conclusion,
    })),
    failureClassifications: record.diagnoses,
    baselineComparisons: record.baselineComparisons,
    cleanupCausedDetermination: aggregateCleanupCaused(
      record.baselineComparisons,
      record.diagnoses
    ),
    unresolvedOwnerActions: record.ownerActions,
    deliveryReady: record.deliveryReady,
    deliveryStatus: record.deliveryState,
  };
}

export async function retryFailedPrChecks(input: {
  owner: string;
  repo: string;
  prNumber: number;
  installationId?: number;
}): Promise<{ retried: boolean; message: string }> {
  const token = await resolveAspGitHubToken({
    owner: input.owner,
    repo: input.repo,
    installationId: input.installationId,
  });
  const client = new GitHubClient(token);
  const pr = await client.getPullRequest(input.owner, input.repo, input.prNumber);
  const runs = await client.listWorkflowRunsForCommit(input.owner, input.repo, pr.headSha);
  const failedRun = runs.find((run) => run.conclusion === "failure");
  if (!failedRun) {
    return {
      retried: false,
      message: "No failed GitHub Actions workflow run was found to retry for this commit.",
    };
  }
  const ok = await client.rerunFailedWorkflowRun(input.owner, input.repo, failedRun.id);
  return {
    retried: ok,
    message: ok
      ? "Failed GitHub Actions jobs were re-requested."
      : "Could not re-request failed GitHub Actions jobs.",
  };
}
