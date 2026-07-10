import { generateChanges, scanRepository } from "@/lib/execution/cleanup-engine";
import { analyzeGuardDelta, deltaPresentation } from "./delta-analysis";
import {
  getGuardRun,
  getGuardSubscription,
  newGuardRun,
  newGuardSubscription,
  saveGuardRun,
  saveGuardSubscription,
  updateSubscriptionAfterRun,
} from "./guard-store";
import {
  loadRepositoryMemory,
  updateRepositoryPolicy,
} from "./repository-memory";
import { policySummary } from "./policy";
import {
  buildGuardNotification,
  buildGuardProposal,
  deliverGuardNotification,
} from "./notifications";
import type { GuardRun, GuardSubscription, GuardTrigger } from "./types";
import {
  commitShaFromPayload,
  extractChangedFilesFromPush,
  isPullRequestMerged,
  repositoryFromGitHubPayload,
  shouldScanForPush,
} from "./webhook-helpers";

export async function activateRepoGuard(input: {
  repoUrl: string;
  branch?: string;
  quoteId?: string;
  paymentReference?: string;
  installationId?: string;
  callbackUrl?: string;
  protectedPaths?: string[];
}): Promise<{ subscription: GuardSubscription; baselineRun: GuardRun }> {
  const findings = await scanRepository(input.repoUrl, input.branch);
  const repository = `${findings.repo.owner}/${findings.repo.name}`;
  const branch = findings.repo.branch;
  const commitSha = findings.repo.commitSha ?? "unknown";

  await updateRepositoryPolicy({
    repository,
    branch,
    protectedPaths: input.protectedPaths,
    githubInstallationId: input.installationId,
    callbackUrl: input.callbackUrl,
  });

  const existing = await getGuardSubscription(repository);
  const subscription =
    existing?.status === "active"
      ? existing
      : await saveGuardSubscription(
          newGuardSubscription({
            repository,
            branch,
            quoteId: input.quoteId,
            paymentReference: input.paymentReference,
            installationId: input.installationId,
          })
        );

  const run = await executeGuardDeltaRun({
    subscription,
    trigger: "manual",
    commitSha,
    forceScan: true,
  });

  return { subscription, baselineRun: run };
}

export async function executeGuardDeltaRun(input: {
  subscription: GuardSubscription;
  trigger: GuardTrigger;
  commitSha: string;
  forceScan?: boolean;
  skipReason?: string;
  changedFiles?: string[];
}): Promise<GuardRun> {
  if (input.subscription.status !== "active") {
    throw new Error("Guard subscription is not active.");
  }

  if (new Date(input.subscription.expiresAt).getTime() < Date.now()) {
    input.subscription.status = "expired";
    await saveGuardSubscription(input.subscription);
    throw new Error("Guard subscription expired.");
  }

  let run = newGuardRun({
    subscriptionId: input.subscription.id,
    repository: input.subscription.repository,
    branch: input.subscription.branch,
    trigger: input.trigger,
    commitSha: input.commitSha,
  });

  if (input.skipReason && !input.forceScan) {
    run.status = "skipped";
    run.skipReason = input.skipReason;
    run.completedAt = new Date().toISOString();
    return saveGuardRun(run);
  }

  if (
    !input.forceScan &&
    input.changedFiles &&
    input.trigger === "push_default_branch"
  ) {
    const decision = shouldScanForPush({ changedFiles: input.changedFiles });
    if (!decision.scan) {
      run.status = "skipped";
      run.skipReason = decision.reason;
      run.completedAt = new Date().toISOString();
      return saveGuardRun(run);
    }
    run.trigger = decision.trigger ?? input.trigger;
  }

  const repoUrl = `https://github.com/${input.subscription.repository}`;
  const findings = await scanRepository(repoUrl, input.subscription.branch);
  const memory = await loadRepositoryMemory(input.subscription.repository, input.subscription.branch);

  const delta = await analyzeGuardDelta({
    memory,
    previousScanId: input.subscription.lastAcceptedScanId,
    currentScanId: findings.scanId,
    previousCommitSha: input.subscription.lastAcceptedCommitSha,
    currentCommitSha: input.commitSha,
    currentFindings: findings,
  });

  const proposal = buildGuardProposal(delta, input.subscription.monthlyPrAllowanceRemaining);
  const notification = buildGuardNotification({
    delta,
    proposal,
    repository: input.subscription.repository,
    trigger: input.trigger,
    suppressedIgnoredCount: delta.ignoredFindings.length,
  });

  run.currentScanId = findings.scanId;
  run.previousScanId = input.subscription.lastAcceptedScanId;
  run.delta = delta;
  run.proposal = proposal;
  run.notification = notification ?? undefined;
  run.status = proposal.type !== "none" ? "awaiting_approval" : "completed";
  run.completedAt = new Date().toISOString();

  if (notification && memory.notificationSettings.callbackUrl) {
    const delivery = await deliverGuardNotification(
      memory.notificationSettings.callbackUrl,
      notification
    );
    if (delivery.delivered) {
      run.notification = { ...notification, channel: "callback" };
    }
  }

  await saveGuardRun(run);
  const updatedSub = await updateSubscriptionAfterRun(input.subscription, run);
  if (proposal.monthlyAllowanceUsed && proposal.type === "cleanup_pr") {
    updatedSub.monthlyPrAllowanceRemaining = Math.max(
      0,
      updatedSub.monthlyPrAllowanceRemaining - 1
    );
    await saveGuardSubscription(updatedSub);
  }

  return run;
}

export async function runManualGuardScan(repository: string): Promise<GuardRun> {
  const subscription = await getGuardSubscription(repository);
  if (!subscription) {
    throw new Error("No active guard subscription for repository.");
  }
  return executeGuardDeltaRun({
    subscription,
    trigger: "manual",
    commitSha: subscription.lastAcceptedCommitSha ?? "manual",
    forceScan: true,
  });
}

export async function processGitHubWebhookEvent(
  event: string,
  payload: Record<string, unknown>
): Promise<{ handled: boolean; run?: GuardRun; reason?: string }> {
  const repo = repositoryFromGitHubPayload(payload);
  if (!repo) return { handled: false, reason: "No repository in payload." };

  const subscription = await getGuardSubscription(repo.fullName);
  if (!subscription || subscription.status !== "active") {
    return { handled: false, reason: "No active guard subscription." };
  }

  let trigger: GuardTrigger | null = null;
  let changedFiles: string[] | undefined;
  let skipReason: string | undefined;

  if (event === "push") {
    const ref = typeof payload.ref === "string" ? payload.ref : "";
    if (ref !== `refs/heads/${subscription.branch}` && ref !== `refs/heads/${repo.defaultBranch}`) {
      return { handled: false, reason: "Push not on monitored branch." };
    }
    changedFiles = extractChangedFilesFromPush(payload);
    const decision = shouldScanForPush({ changedFiles });
    if (!decision.scan) {
      return { handled: true, reason: decision.reason };
    }
    trigger = decision.trigger ?? "push_default_branch";
  } else if (event === "pull_request") {
    if (!isPullRequestMerged(payload)) {
      return { handled: false, reason: "PR event not a merge." };
    }
    trigger = "pull_request_merged";
  } else {
    return { handled: false, reason: `Unsupported event: ${event}` };
  }

  const commitSha = commitShaFromPayload(event, payload);
  if (!commitSha) {
    return { handled: false, reason: "Could not determine commit SHA." };
  }

  const run = await executeGuardDeltaRun({
    subscription,
    trigger,
    commitSha,
    changedFiles,
    skipReason,
  });

  return { handled: true, run };
}

export async function approveGuardProposal(
  runId: string,
  approved: boolean
): Promise<GuardRun> {
  const run = await getGuardRun(runId);
  if (!run) throw new Error("Guard run not found.");
  if (run.status !== "awaiting_approval") {
    throw new Error(`Run is not awaiting approval (status=${run.status}).`);
  }

  if (!approved) {
    run.status = "completed";
    run.completedAt = new Date().toISOString();
    run.proposal = { ...run.proposal!, reason: "User declined proposal.", type: "none", findingIds: [] };
    return saveGuardRun(run);
  }

  if (!run.proposal || run.proposal.findingIds.length === 0 || !run.currentScanId) {
    run.status = "completed";
    return saveGuardRun(run);
  }

  const { getStoredFindings } = await import("@/lib/findings/findings-store");
  const findings = await getStoredFindings(run.currentScanId);
  if (!findings) throw new Error("Scan findings not found.");

  const result = await generateChanges(findings, {
    findingIds: run.proposal.findingIds,
    maxFixes: run.proposal.findingIds.length,
  });

  run.status = "completed";
  run.completedAt = new Date().toISOString();
  run.proposal = {
    ...run.proposal,
    reason: `${run.proposal.reason} Applied ${result.selectedFindings.length} fix(es) — PR requires separate GitHub delivery step.`,
  };

  return saveGuardRun(run);
}

export async function getGuardStatus(repository: string): Promise<Record<string, unknown>> {
  const subscription = await getGuardSubscription(repository);
  if (!subscription) {
    return { active: false, repository };
  }
  const memory = await loadRepositoryMemory(repository, subscription.branch);
  let lastRun: GuardRun | undefined;
  if (subscription.lastRunId) {
    lastRun = await getGuardRun(subscription.lastRunId);
  }
  return {
    active: subscription.status === "active",
    subscription,
    policy: policySummary(memory),
    lastRun: lastRun
      ? {
          id: lastRun.id,
          status: lastRun.status,
          trigger: lastRun.trigger,
          commitSha: lastRun.commitSha,
          delta: lastRun.delta ? deltaPresentation(lastRun.delta) : null,
          proposal: lastRun.proposal,
          notification: lastRun.notification,
        }
      : null,
  };
}

export async function runDueWeeklyScans(): Promise<GuardRun[]> {
  const runs: GuardRun[] = [];
  const testRepo = process.env.REPODIET_GUARD_WEEKLY_REPO;
  if (testRepo) {
    const subscription = await getGuardSubscription(testRepo);
    if (
      subscription &&
      subscription.status === "active" &&
      new Date(subscription.nextWeeklyScanAt).getTime() <= Date.now()
    ) {
      runs.push(
        await executeGuardDeltaRun({
          subscription,
          trigger: "weekly_scheduled",
          commitSha: subscription.lastAcceptedCommitSha ?? "weekly",
          forceScan: true,
        })
      );
    }
  }
  return runs;
}
